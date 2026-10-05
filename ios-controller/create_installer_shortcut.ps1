$ws = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath('Desktop')
$shortcut = $ws.CreateShortcut("$desktop\Install Sideloadly.lnk")
$shortcut.TargetPath = "c:\github\LightningStudio\ios-controller\SideloadlySetup.exe"
$shortcut.WorkingDirectory = "c:\github\LightningStudio\ios-controller"
$shortcut.IconLocation = "shell32.dll,2"
$shortcut.Save()
Write-Output "Created shortcut to Sideloadly Installer on Desktop."
