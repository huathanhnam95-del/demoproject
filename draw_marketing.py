import win32com.client
import sys

def draw():
    try:
        visio = win32com.client.Dispatch("Visio.Application")
        visio.Visible = True
        doc = visio.Documents.Add("")
        page = visio.ActivePage

        # Page setup to Landscape
        page.PageSheet.Cells("PageWidth").ResultIU = 11.0
        page.PageSheet.Cells("PageHeight").ResultIU = 8.5

        def create_rect(cx, cy, w, h, text, rgb):
            shape = page.DrawRectangle(cx - w/2, cy - h/2, cx + w/2, cy + h/2)
            shape.Text = text
            shape.Cells("FillForegnd").FormulaU = f"RGB({rgb[0]}, {rgb[1]}, {rgb[2]})"
            shape.Cells("LinePattern").FormulaU = "0" # No border
            shape.Cells("Char.Font").FormulaU = "0"
            shape.Cells("Char.Style").FormulaU = "17" # Bold
            return shape

        def create_oval(cx, cy, w, h, text, rgb):
            shape = page.DrawOval(cx - w/2, cy - h/2, cx + w/2, cy + h/2)
            shape.Text = text
            shape.Cells("FillForegnd").FormulaU = f"RGB({rgb[0]}, {rgb[1]}, {rgb[2]})"
            shape.Cells("LinePattern").FormulaU = "0" # No border
            return shape

        def connect(s1, s2):
            # 1 = Dynamic connector usually, but without stencil we can just draw a line and glue it
            conn = page.Drop(visio.Application.ConnectorToolDataObject, 0, 0)
            conn.Cells("BeginX").GlueTo(s1.Cells("PinX"))
            conn.Cells("EndX").GlueTo(s2.Cells("PinX"))
            conn.Cells("LineColor").FormulaU = "RGB(150, 150, 150)"
            conn.Cells("LineWeight").ResultIU = 0.01
            # Try to make connection curved
            try:
                conn.Cells("ShapeRouteStyle").FormulaU = "2"
            except:
                pass
            return conn

        blue = (190, 216, 255)
        green = (46, 204, 113)

        # Center node
        center = create_oval(4.5, 4.25, 2.0, 1.0, "Chiến lược\nMarketing", green)

        # Level 1 Nodes
        nhan_tin = create_rect(2.5, 6.0, 1.8, 1.0, "Nhắn tin", blue)
        quang_cao = create_rect(4.5, 2.0, 1.8, 1.0, "Quảng cáo", blue)
        gioi_thieu = create_rect(7.0, 4.25, 1.8, 1.0, "Giới thiệu sản\nphẩm", blue)

        connect(center, nhan_tin)
        connect(center, quang_cao)
        connect(center, gioi_thieu)

        # Level 2 Nodes - Nhắn tin
        nt1 = create_oval(0.8, 7.0, 1.2, 0.6, "Qua điện\nthoại", blue)
        nt2 = create_oval(0.7, 6.0, 1.2, 0.6, "Truyền\nhình", blue)
        nt3 = create_oval(0.8, 5.0, 1.2, 0.6, "Báo chí", blue)
        connect(nhan_tin, nt1)
        connect(nhan_tin, nt2)
        connect(nhan_tin, nt3)

        # Level 2 Nodes - Giới thiệu
        gt1 = create_oval(9.2, 6.5, 1.4, 0.6, "Nhà phân\nphối", blue)
        gt2 = create_oval(9.3, 5.5, 1.4, 0.6, "Phim giới\nthiệu", blue)
        gt3 = create_oval(9.3, 4.5, 1.4, 0.6, "Sản phẩm\ndùng thử", blue)
        gt4 = create_oval(9.2, 3.5, 1.4, 0.6, "TT khuyến\nmãi", blue)
        connect(gioi_thieu, gt1)
        connect(gioi_thieu, gt2)
        connect(gioi_thieu, gt3)
        connect(gioi_thieu, gt4)

        # Level 2 Nodes - Quảng cáo
        qc1 = create_oval(6.8, 2.5, 1.4, 0.6, "Truyền hình", blue)
        qc2 = create_oval(6.8, 1.8, 1.4, 0.6, "Báo", blue)
        qc3 = create_oval(6.8, 1.1, 1.4, 0.6, "Tờ rơi", blue)
        connect(quang_cao, qc1)
        connect(quang_cao, qc2)
        connect(quang_cao, qc3)
        
        # Adjust routing layout
        page.Layout()
        
    except Exception as e:
        print("Mã lỗi:", e)

if __name__ == '__main__':
    draw()
