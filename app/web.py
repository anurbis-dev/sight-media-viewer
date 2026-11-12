"""A small FastAPI-shaped router on plain Starlette.

FastAPI + pydantic cost ~400 ms of imports and ~100 ms of route / model setup at every start on the
owner's machine (docs/PLAN.md), and Sight used none of what they add: every route takes path / query
parameters of type str or int and / or the raw Request, and returns a dict / list or a Response.
This module keeps server.py's decorators as they were — `@app.get("/api/x/{aid}")` on a plain
function — and does the little FastAPI did for them:

- parameters are filled by name from the path, then the query string; `int` ones are converted
  (a bad value → 422, like FastAPI); a parameter annotated `Request` gets the request;
- plain `def` endpoints run in the thread pool (FastAPI does the same), `async def` ones on the loop;
- a returned Response goes out as is, anything else as JSON (Path → str, set / tuple → list);
- HTTPException → `{"detail": ...}` JSON with its status, as FastAPI answered (annotate.js reads
  `detail` from a failed import).

Annotations are read as strings (server.py uses `from __future__ import annotations`), so only the
names "Request", "int", "float", "bool" and "str" matter; anything else is passed as a string.
"""

from __future__ import annotations

import inspect
import json
import math
from pathlib import PurePath
from types import SimpleNamespace
from typing import Any, Callable

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

__all__ = ["App", "HTTPException", "Request", "FileResponse", "JSONResponse", "Response", "StreamingResponse", "StaticFiles"]


def _default(o: Any) -> Any:
    if isinstance(o, PurePath):
        return str(o)
    if isinstance(o, (set, frozenset, tuple)):
        return list(o)
    if isinstance(o, bytes):
        return o.decode("utf-8", "replace")
    raise TypeError(f"{type(o).__name__} is not JSON serializable")


def _finite(o: Any) -> Any:
    """Non-finite floats → None, as FastAPI's serializer did (a stored inf — e.g. from a .srev or a
    PATCH body, which Python's json accepts — must not turn every listing into a 500)."""
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _finite(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_finite(v) for v in o]
    return o


class _JSON(JSONResponse):
    def render(self, content: Any) -> bytes:
        dump = lambda c: json.dumps(c, ensure_ascii=False, allow_nan=False, separators=(",", ":"), default=_default).encode("utf-8")
        try:
            return dump(content)
        except ValueError:  # inf / nan somewhere: the slow path only then
            return dump(_finite(content))


def _annotation_name(a: Any) -> str:
    if a is inspect.Parameter.empty:
        return ""
    if isinstance(a, str):
        return a.split("|")[0].strip().rsplit(".", 1)[-1]
    return getattr(a, "__name__", "")


_CONVERT: dict[str, Callable[[str], Any]] = {
    "int": int,
    "float": float,
    "bool": lambda v: v.lower() in ("1", "true", "yes", "on"),
}


def _endpoint(fn: Callable) -> Callable:
    """Wraps a FastAPI-style handler into a Starlette endpoint (request → response)."""
    params = []
    for p in inspect.signature(fn).parameters.values():
        kind = _annotation_name(p.annotation)
        params.append((p.name, kind, p.default))
    is_async = inspect.iscoroutinefunction(fn)

    async def endpoint(request: Request) -> Response:
        if request.method == "HEAD":  # Starlette adds HEAD to GET routes; FastAPI did not run them
            return _JSON({"detail": "Method Not Allowed"}, status_code=405, headers={"Allow": "GET"})
        kwargs: dict[str, Any] = {}
        for name, kind, default in params:
            if kind == "Request":
                kwargs[name] = request
                continue
            if name in request.path_params:
                raw = request.path_params[name]
            elif name in request.query_params:
                raw = request.query_params[name]
            elif default is not inspect.Parameter.empty:
                kwargs[name] = default
                continue
            else:
                return _JSON({"detail": f"missing parameter: {name}"}, status_code=422)
            conv = _CONVERT.get(kind)
            if conv is not None:
                try:
                    raw = conv(str(raw))
                except ValueError:
                    return _JSON({"detail": f"bad value for {name}: {raw!r}"}, status_code=422)
            kwargs[name] = raw
        out = await fn(**kwargs) if is_async else await run_in_threadpool(fn, **kwargs)
        return out if isinstance(out, Response) else _JSON(out)

    endpoint.__name__ = fn.__name__
    return endpoint


async def _http_error(request: Request, exc: HTTPException) -> Response:
    return _JSON({"detail": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


class App:
    """Collects routes with FastAPI's decorator shape; `asgi()` builds the Starlette app. The App
    itself is an ASGI callable too (built on first use), so uvicorn can take it directly."""

    def __init__(self) -> None:
        self.routes: list = []
        self.state = SimpleNamespace()
        self._asgi: Starlette | None = None

    def _add(self, method: str, path: str) -> Callable[[Callable], Callable]:
        def deco(fn: Callable) -> Callable:
            self.routes.append(Route(path, _endpoint(fn), methods=[method], name=fn.__name__))
            self._asgi = None
            return fn
        return deco

    def get(self, path: str) -> Callable[[Callable], Callable]:
        return self._add("GET", path)

    def post(self, path: str) -> Callable[[Callable], Callable]:
        return self._add("POST", path)

    def put(self, path: str) -> Callable[[Callable], Callable]:
        return self._add("PUT", path)

    def patch(self, path: str) -> Callable[[Callable], Callable]:
        return self._add("PATCH", path)

    def delete(self, path: str) -> Callable[[Callable], Callable]:
        return self._add("DELETE", path)

    def mount(self, path: str, app: Any, name: str | None = None) -> None:
        self.routes.append(Mount(path, app=app, name=name))
        self._asgi = None

    def asgi(self) -> Starlette:
        if self._asgi is None:
            self._asgi = Starlette(routes=list(self.routes), exception_handlers={HTTPException: _http_error})
        return self._asgi

    async def __call__(self, scope, receive, send) -> None:
        await self.asgi()(scope, receive, send)
