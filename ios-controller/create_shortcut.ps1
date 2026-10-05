$ws = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath('Desktop')
$shortcut = $ws.CreateShortcut("$desktop\Start iOS Tunnel.lnk")
$shortcut.TargetPath = "c:\github\LightningStudio\ios-controller\start-tunnel.bat"
$shortcut.WorkingDirectory = "c:\github\LightningStudio\ios-controller"
$shortcut.IconLocation = "shell32.dll,18"
$shortcut.Save()
Write-Output "Desktop shortcut created successfully."
