import win32com.client
import os

visio = win32com.client.Dispatch("Visio.Application")

try:
    doc = visio.Documents.Add("")
    page = visio.ActivePage
    # Page setup Landscape
    page.PageSheet.Cells("PageWidth").ResultIU = 11
    page.PageSheet.Cells("PageHeight").ResultIU = 8.5

    def draw_box(x, y, text, width=1.8, height=0.6):
        shape = page.DrawRectangle(x - width/2.0, y - height/2.0, x + width/2.0, y + height/2.0)
        shape.Text = text
        # Styling: Blue fill, bold text, white text
        shape.Cells("FillForegnd").FormulaU = "RGB(79, 129, 189)"
        shape.Cells("LineColor").FormulaU = "RGB(255, 255, 255)"
        shape.Cells("Char.Color").FormulaU = "1" # Visio usually Color 1 is White or Black? "RGB(255, 255, 255)" is safer. Actually let's use "RGB(255,255,255)"
        shape.Cells("Char.Color").FormulaU = "RGB(255, 255, 255)"
        shape.Cells("Char.Style").FormulaU = "17" # Bold
        shape.Cells("Char.Size").FormulaU = "12 pt"
        # Shadow
        shape.Cells("ShdwPattern").FormulaU = "1"
        return shape

    def draw_connector(shape1, shape2):
        # Drop dynamic connector
        conn = page.Drop(visio.Application.ConnectorToolDataObject, 0, 0)
        # Glue to centers
        conn.CellsU("BeginX").GlueTo(shape1.CellsU("PinX"))
        conn.CellsU("EndX").GlueTo(shape2.CellsU("PinX"))
        return conn

    # Top
    top = draw_box(5.5, 7.5, "TỔNG GIÁM ĐỐC", width=2.5, height=0.7)

    # Level 2
    left_mgr = draw_box(3.0, 6.0, "Giám Đốc Điều Hành", width=2.2, height=0.7)
    draw_connector(top, left_mgr)

    right_mgr = draw_box(8.0, 6.0, "Phó Tổng Giám Đốc", width=2.2, height=0.7)
    draw_connector(top, right_mgr)

    # Level 3 Left
    l_c1 = draw_box(1.8, 4.5, "Phòng Kinh Doanh", width=1.6, height=0.6)
    l_c2 = draw_box(4.2, 4.5, "Phòng quảng cáo và\ntổ chức sự kiện", width=1.6, height=0.6)
    l_c3 = draw_box(1.8, 3.5, "Phòng Tài Chính\nVà Nhân Sự", width=1.6, height=0.6)
    l_c4 = draw_box(4.2, 3.5, "Phòng Kế Toán", width=1.6, height=0.6)
    
    for c in [l_c1, l_c2, l_c3, l_c4]:
        draw_connector(left_mgr, c)

    # Level 3 Right
    r_c1 = draw_box(6.8, 4.5, "Phòng Đầu Số\nTin Nhắn", width=1.6, height=0.6)
    r_c2 = draw_box(9.2, 4.5, "Phòng Phát\nThanh", width=1.6, height=0.6)
    r_c3 = draw_box(6.8, 3.5, "Phòng thỏa mãn và\nchăm sóc khách hàng", width=1.6, height=0.6)
    r_c4 = draw_box(9.2, 3.5, "Phòng Kế Hoạch", width=1.6, height=0.6)
    r_c5 = draw_box(6.8, 2.5, "Phòng Thiết Kế", width=1.6, height=0.6)
    r_c6 = draw_box(9.2, 2.5, "Phòng Kỹ Thuật", width=1.6, height=0.6)

    for c in [r_c1, r_c2, r_c3, r_c4, r_c5, r_c6]:
        draw_connector(right_mgr, c)

    filepath = r"c:\Cursor AI\org_chart.vsdx"
    if os.path.exists(filepath):
        try: os.remove(filepath)
        except: pass
    
    doc.SaveAs(filepath)

finally:
    try: visio.Quit()
    except: pass
