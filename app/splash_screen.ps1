param(
    [int]$MaxWaitSeconds = 45
)

# Small native "Sight is loading" indicator shown the instant Sight launches - purely a sign of
# life while bootstrap/server start happen (a fresh venv install, first-run library scan, etc.).
# It is NOT trying to mask the real browser window's own blank/white first frame - that's handled
# separately in Sight.py (the browser is launched off-screen, still rendering normally, and
# reveal_when_ready() moves it into view once the page has actually rendered), rather than covering
# it with something the same size. Sight.py normally closes this process directly once that
# happens; MaxWaitSeconds is only a safety net for "that never happened".

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$colorBg = [System.Drawing.ColorTranslator]::FromHtml('#0a0a0b')
$colorFg = [System.Drawing.ColorTranslator]::FromHtml('#f2f2f0')
$colorMuted = [System.Drawing.ColorTranslator]::FromHtml('#71716c')

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.StartPosition = 'Manual'
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.BackColor = $colorBg
$form.ClientSize = New-Object System.Drawing.Size(280, 160)

$screen = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position)
$bounds = $screen.Bounds
$x = $bounds.X + [int](($bounds.Width - $form.ClientSize.Width) / 2)
$y = $bounds.Y + [int](($bounds.Height - $form.ClientSize.Height) / 2)
$form.Location = New-Object System.Drawing.Point($x, $y)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Sight'
$title.Dock = 'Fill'
$title.TextAlign = 'MiddleCenter'
$title.ForeColor = $colorFg
$title.BackColor = $colorBg
$title.Font = New-Object System.Drawing.Font('Georgia', 24, [System.Drawing.FontStyle]::Italic)
$form.Controls.Add($title)

$status = New-Object System.Windows.Forms.Label
$status.Text = 'loading…'
$status.Dock = 'Bottom'
$status.Height = 26
$status.TextAlign = 'MiddleCenter'
$status.ForeColor = $colorMuted
$status.BackColor = $colorBg
$status.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$form.Controls.Add($status)
$status.BringToFront()

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [Math]::Max(1, $MaxWaitSeconds) * 1000
$timer.Add_Tick({ $form.Close() })
$timer.Start()

$form.Show()
[System.Windows.Forms.Application]::Run($form)
