# Скрипт ищет нативное окно КриптоПро "Подтверждение доступа" и нажимает кнопку "Да".
# Запуск: powershell -ExecutionPolicy Bypass -STA -File cryptopro-click-allow.ps1 [секунд_ожидания]
# Требуется: Windows, UI Automation (встроено).

param([int]$TimeoutSeconds = 90)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$InvokePatternId = [System.Windows.Automation.InvokePattern]::Pattern.Id
$NamePropId = [System.Windows.Automation.AutomationElement]::NameProperty
$ControlTypePropId = [System.Windows.Automation.AutomationElement]::ControlTypeProperty
$ButtonControlType = [System.Windows.Automation.ControlType]::Button
$WindowControlType = [System.Windows.Automation.ControlType]::Window

function Find-AndClickAllow {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $winCondition = [System.Windows.Automation.PropertyCondition]::new($ControlTypePropId, $WindowControlType)
    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $winCondition)
    foreach ($win in $windows) {
        try {
            $title = $win.GetCurrentPropertyValue($NamePropId)
            if ($null -eq $title) { $title = '' } else { $title = $title.ToString() }
            if ($title -match 'Подтверждение доступа|КриптоПро|ЭЦП|доступа') {
                $btnCondition = [System.Windows.Automation.PropertyCondition]::new($NamePropId, 'Да')
                $btn = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $btnCondition)
                if ($null -ne $btn) {
                    $invoke = $btn.GetCurrentPattern($InvokePatternId)
                    $invoke.Invoke()
                    return $true
                }
                $btnYesCond = [System.Windows.Automation.PropertyCondition]::new($NamePropId, 'Yes')
                $btnYes = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $btnYesCond)
                if ($null -ne $btnYes) {
                    $invoke = $btnYes.GetCurrentPattern($InvokePatternId)
                    $invoke.Invoke()
                    return $true
                }
            }
        } catch {}
    }
    return $false
}

$end = [DateTime]::Now.AddSeconds($TimeoutSeconds)
while ([DateTime]::Now -lt $end) {
    if (Find-AndClickAllow) {
        exit 0
    }
    Start-Sleep -Milliseconds 1500
}
exit 1
