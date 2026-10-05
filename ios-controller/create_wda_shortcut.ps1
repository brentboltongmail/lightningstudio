$ws = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath('Desktop')
$shortcut = $ws.CreateShortcut("$desktop\WebDriverAgent Runner.lnk")
$shortcut.TargetPath = "c:\github\LightningStudio\ios-controller\WebDriverAgentRunner-Runner.ipa"
$shortcut.WorkingDirectory = "c:\github\LightningStudio\ios-controller"
$shortcut.IconLocation = "shell32.dll,43"
$shortcut.Save()
Write-Output "Created shortcut to WDA Runner."
