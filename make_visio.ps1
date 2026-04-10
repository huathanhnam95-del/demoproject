$visio = New-Object -ComObject Visio.Application
# Not changing Visible is safer. Usually it starts invisible.

try {
    $doc = $visio.Documents.Add("")
    $page = $visio.ActivePage
    $page.PageSheet.Cells("PageWidth").ResultIU = 11
    $page.PageSheet.Cells("PageHeight").ResultIU = 8.5

    function Draw-Box($x, $y, $text, $width, $height) {
        $shape = $page.DrawRectangle($x - $width / 2, $y - $height / 2, $x + $width / 2, $y + $height / 2)
        $shape.Text = $text
        $shape.Cells("FillForegnd").FormulaU = "RGB(79, 129, 189)"
        $shape.Cells("LineColor").FormulaU = "RGB(255, 255, 255)"
        $shape.Cells("Char.Color").FormulaU = "RGB(255, 255, 255)"
        $shape.Cells("Char.Style").FormulaU = "17" # Bold
        $shape.Cells("Char.Size").FormulaU = "12 pt"
        $shape.Cells("ShdwPattern").FormulaU = "1"
        return $shape
    }

    function Draw-Connector([System.__ComObject]$src, [System.__ComObject]$dst) {
        # AutoConnect(dst, dir) where 0 = visAutoConnectDirNone
        $src.AutoConnect($dst, 0)
    }

    $top = Draw-Box 5.5 7.5 'TỔNG GIÁM ĐỐC' 2.5 0.7

    $left_mgr = Draw-Box 3.0 6.0 'Giám Đốc Điều Hành' 2.2 0.7
    Draw-Connector $top $left_mgr

    $right_mgr = Draw-Box 8.0 6.0 'Phó Tổng Giám Đốc' 2.2 0.7
    Draw-Connector $top $right_mgr

    $l_c1 = Draw-Box 1.8 4.5 'Phòng Kinh Doanh' 1.6 0.6
    $l_c2 = Draw-Box 4.2 4.5 "Phòng quảng cáo và`ntổ chức sự kiện" 1.6 0.6
    $l_c3 = Draw-Box 1.8 3.5 "Phòng Tài Chính`nVà Nhân Sự" 1.6 0.6
    $l_c4 = Draw-Box 4.2 3.5 'Phòng Kế Toán' 1.6 0.6
    
    Draw-Connector $left_mgr $l_c1
    Draw-Connector $left_mgr $l_c2
    Draw-Connector $left_mgr $l_c3
    Draw-Connector $left_mgr $l_c4

    $r_c1 = Draw-Box 6.8 4.5 "Phòng Đầu Số`nTin Nhắn" 1.6 0.6
    $r_c2 = Draw-Box 9.2 4.5 "Phòng Phát`nThanh" 1.6 0.6
    $r_c3 = Draw-Box 6.8 3.5 "Phòng thỏa mãn và`nchăm sóc khách hàng" 1.6 0.6
    $r_c4 = Draw-Box 9.2 3.5 'Phòng Kế Hoạch' 1.6 0.6
    $r_c5 = Draw-Box 6.8 2.5 'Phòng Thiết Kế' 1.6 0.6
    $r_c6 = Draw-Box 9.2 2.5 'Phòng Kỹ Thuật' 1.6 0.6

    Draw-Connector $right_mgr $r_c1
    Draw-Connector $right_mgr $r_c2
    Draw-Connector $right_mgr $r_c3
    Draw-Connector $right_mgr $r_c4
    Draw-Connector $right_mgr $r_c5
    Draw-Connector $right_mgr $r_c6

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
