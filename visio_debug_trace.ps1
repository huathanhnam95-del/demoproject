$visio = New-Object -ComObject Visio.Application
$visio.Visible = $true

try {
    Write-Host "Adding document..."
    $doc = $visio.Documents.Add("")
    Write-Host "Active page..."
    $page = $visio.ActivePage
    $page.PageSheet.Cells("PageWidth").ResultIU = 11.0
    $page.PageSheet.Cells("PageHeight").ResultIU = 8.5

    Write-Host "Drawing Box 1..."
    $shape1 = $page.DrawRectangle(4.25, 7.15, 6.75, 7.85)
    Write-Host "Setting Text 1..."
    $shape1.Text = 'CEO'

    Write-Host "Drawing Box 2..."
    $shape2 = $page.DrawRectangle(1.9, 5.65, 4.1, 6.35)
    Write-Host "Setting Text 2..."
    $shape2.Text = 'Manager'

    Write-Host "Drawing Line..."
    $line = $page.DrawLine(5.5, 7.15, 3.0, 6.35)
    
    Write-Host "Saving file..."
    $filepath = "c:\Cursor AI\org_chart.vsdx"
    if (Test-Path $filepath) { Remove-Item $filepath -Force }
    $doc.SaveAs($filepath)
    Write-Output "Successfully saved $filepath"
}
finally {
    try {
        $visio.Quit()
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($visio) | Out-Null
    }
    catch {}
}
