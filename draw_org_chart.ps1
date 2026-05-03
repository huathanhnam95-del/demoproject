$visio = New-Object -ComObject Visio.Application
$visio.Visible = $false

try {
    $doc = $visio.Documents.Add("")
    $page = $visio.ActivePage
    $page.PageSheet.Cells("PageWidth").ResultIU = 11.0
    $page.PageSheet.Cells("PageHeight").ResultIU = 8.5

    function Draw-Box([double]$x, [double]$y, [string]$text, [double]$w, [double]$h) {
        $x1 = $x - ($w / 2.0)
        $y1 = $y - ($h / 2.0)
        $x2 = $x + ($w / 2.0)
        $y2 = $y + ($h / 2.0)
        
        $shape = $page.DrawRectangle($x1, $y1, $x2, $y2)
        $shape.Text = $text
        $shape.Cells("FillForegnd").FormulaU = "RGB(79,129,189)"
        $shape.Cells("LineColor").FormulaU = "RGB(255,255,255)"
        $shape.Cells("Char.Color").FormulaU = "RGB(255,255,255)"
        $shape.Cells("Char.Style").FormulaU = "17"
        $shape.Cells("Char.Size").FormulaU = "10 pt"
        $shape.Cells("ShdwPattern").FormulaU = "1"
        return $shape
    }

    function Draw-Line([double]$x1, [double]$y1, [double]$x2, [double]$y2) {
        $shape = $page.DrawLine($x1, $y1, $x2, $y2)
        return $shape
    }

    # Strings are defined in bytes and converted to avoiding any PowerShell ANSI issues
    $txt_top = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("VOG7lE5HIEdJw4BNIMSQ4buQQw=="))
    $txt_left = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("R2nDoW0gxJDhu5FjIMSQaeG7gXUgSMOgbmg="))
    $txt_right = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("UGjDsyBU4buRbmcgR2nDoW0gxJDhu5Fc"))
    $txt_l1 = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("UGjDsm5nIEtpbmggRG9hbmQ="))
    $txt_l2 = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("UGjDsm5nIHF14bqjbmcgY8OhbyB2w6ANCnThu5UgY2jhu6ljIHPhu7Ega2nhu4du"))
    $txt_l3 = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("UGjDsm5nIFTDoGkgQ2jDrW5oDQpWw6AgTmjDom4gU+G7sQ=="))
    $txt_l4 = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("UGjDsm5nIEvhur8gVG/DoW4="))
    
    $txt_r1 = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("UGjDsm5nIMSQ4bqndSBT4buRDQpUaW4gTmjhuq9u"))
    $txt_r2 = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("UGjDsm5nIFBow6F0DQpUaGFuaA=="))
    $txt_r3 = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("UGjDsm5nIHRo4buPYSBtw6NuIHbDoA0KY2jEg20gc8OzYyBraMOhY2ggaMOgbmc="))
    $txt_r4 = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("UGjDsm5nIEvhur8gSG/huqFjaA=="))
    $txt_r5 = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("UGjDsm5nIFRoaeG6v3QgS+G6vw=="))
    $txt_r6 = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("UGjDsm5nIEvhu7kgVGh14bqtdA=="))

    $top = Draw-Box 5.5 7.5 $txt_top 2.5 0.7

    $left_mgr = Draw-Box 3.0 6.0 $txt_left 2.2 0.7
    Draw-Line 5.5 7.15 3.0 6.35

    $right_mgr = Draw-Box 8.0 6.0 $txt_right 2.2 0.7
    Draw-Line 5.5 7.15 8.0 6.35

    $l_c1 = Draw-Box 1.8 4.5 $txt_l1 1.6 0.6
    $l_c2 = Draw-Box 4.2 4.5 $txt_l2 1.6 0.6
    $l_c3 = Draw-Box 1.8 3.5 $txt_l3 1.6 0.6
    $l_c4 = Draw-Box 4.2 3.5 $txt_l4 1.6 0.6
    
    Draw-Line 3.0 5.65 1.8 4.8
    Draw-Line 3.0 5.65 4.2 4.8
    Draw-Line 1.8 4.2 1.8 3.8
    Draw-Line 4.2 4.2 4.2 3.8

    $r_c1 = Draw-Box 6.8 4.5 $txt_r1 1.6 0.6
    $r_c2 = Draw-Box 9.2 4.5 $txt_r2 1.6 0.6
    $r_c3 = Draw-Box 6.8 3.5 $txt_r3 1.6 0.6
    $r_c4 = Draw-Box 9.2 3.5 $txt_r4 1.6 0.6
    $r_c5 = Draw-Box 6.8 2.5 $txt_r5 1.6 0.6
    $r_c6 = Draw-Box 9.2 2.5 $txt_r6 1.6 0.6

    Draw-Line 8.0 5.65 6.8 4.8
    Draw-Line 8.0 5.65 9.2 4.8
    Draw-Line 6.8 4.2 6.8 3.8
    Draw-Line 9.2 4.2 9.2 3.8
    Draw-Line 6.8 3.2 6.8 2.8
    Draw-Line 9.2 3.2 9.2 2.8

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
