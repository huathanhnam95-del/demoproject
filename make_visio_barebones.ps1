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
        return $shape
    }

    function Draw-Line([double]$x1, [double]$y1, [double]$x2, [double]$y2) {
        $shape = $page.DrawLine($x1, $y1, $x2, $y2)
        return $shape
    }

    $top = Draw-Box 5.5 7.5 'TỔNG GIÁM ĐỐC' 2.5 0.7

    $left_mgr = Draw-Box 3.0 6.0 'Giám Đốc Điều Hành' 2.2 0.7
    Draw-Line 5.5 7.15 3.0 6.35

    $right_mgr = Draw-Box 8.0 6.0 'Phó Tổng Giám Đốc' 2.2 0.7
    Draw-Line 5.5 7.15 8.0 6.35

    $l_c1 = Draw-Box 1.8 4.5 'Phòng Kinh Doanh' 1.6 0.6
    $l_c2 = Draw-Box 4.2 4.5 "Phòng quảng cáo và`ntổ chức sự kiện" 1.6 0.6
    $l_c3 = Draw-Box 1.8 3.5 "Phòng Tài Chính`nVà Nhân Sự" 1.6 0.6
    $l_c4 = Draw-Box 4.2 3.5 'Phòng Kế Toán' 1.6 0.6
    
    Draw-Line 3.0 5.65 1.8 4.8
    Draw-Line 3.0 5.65 4.2 4.8
    Draw-Line 1.8 4.2 1.8 3.8
    Draw-Line 4.2 4.2 4.2 3.8

    $r_c1 = Draw-Box 6.8 4.5 "Phòng Đầu Số`nTin Nhắn" 1.6 0.6
    $r_c2 = Draw-Box 9.2 4.5 "Phòng Phát`nThanh" 1.6 0.6
    $r_c3 = Draw-Box 6.8 3.5 "Phòng thỏa mãn và`nchăm sóc khách hàng" 1.6 0.6
    $r_c4 = Draw-Box 9.2 3.5 'Phòng Kế Hoạch' 1.6 0.6
    $r_c5 = Draw-Box 6.8 2.5 'Phòng Thiết Kế' 1.6 0.6
    $r_c6 = Draw-Box 9.2 2.5 'Phòng Kỹ Thuật' 1.6 0.6

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
