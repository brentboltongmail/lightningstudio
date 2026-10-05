$ws = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath('Desktop')
$shortcut = $ws.CreateShortcut("$desktop\iOS Controller App.lnk")
$shortcut.TargetPath = "c:\github\LightningStudio\ios-controller\run.bat"
$shortcut.WorkingDirectory = "c:\github\LightningStudio\ios-controller"
$shortcut.IconLocation = "shell32.dll,13"
$shortcut.Save()
Write-Output "App desktop shortcut created successfully."
