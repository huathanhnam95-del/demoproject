import xlsxwriter

def create_excel():
    workbook = xlsxwriter.Workbook('Tourism_List.xlsx')
    worksheet = workbook.add_worksheet('Danh Sach')

    # Formats
    title_format = workbook.add_format({'bold': True, 'align': 'left', 'valign': 'vcenter'})
    header_main_format = workbook.add_format({'bold': True, 'align': 'center', 'valign': 'vcenter', 'font_size': 14})
    date_format = workbook.add_format({'italic': True, 'align': 'center', 'valign': 'vcenter'})
    
    table_header_format = workbook.add_format({
        'bold': True, 
        'bg_color': '#D9EAD3', 
        'border': 1, 
        'align': 'center', 
        'valign': 'vcenter',
        'text_wrap': True
    })
    
    cell_format = workbook.add_format({'border': 1, 'align': 'left', 'valign': 'vcenter'})
    center_format = workbook.add_format({'border': 1, 'align': 'center', 'valign': 'vcenter'})
    currency_format = workbook.add_format({'border': 1, 'num_format': '#,##0', 'align': 'right', 'valign': 'vcenter'})

    # Column Widths
    worksheet.set_column('A:A', 5)
    worksheet.set_column('B:B', 25)
    worksheet.set_column('C:C', 10)
    worksheet.set_column('D:D', 15)
    worksheet.set_column('E:E', 12)
    worksheet.set_column('F:F', 12)
    worksheet.set_column('G:G', 12)

    # 1. Main Title and Headings
    worksheet.merge_range('A1:B1', 'CÔNG TY DU LỊCH QUÊ HƯƠNG', title_format)
    worksheet.merge_range('A3:G3', 'DANH SÁCH KHÁCH DU LỊCH', header_main_format)
    worksheet.merge_range('A4:G4', 'Ngày 25 tháng 10 năm 2012', date_format)

    # 2. Main Table Header
    headers = ['STT', 'HỌ VÀ TÊN', 'MÃ DL', 'TÊN ĐỊA PHƯƠNG', 'GIÁ VÉ TÀU XE', 'CHI PHÍ', 'THU']
    for col, header in enumerate(headers):
        worksheet.write(5, col, header, table_header_format)

    # 3. Reference Table Data (Bảng 2)
    # Positions in sheet for lookup: 
    # MÃ DP (A22-A24), Tên (B22-B24), Giá (C22-C24), Loại A (D22-D24), Loại B (E22-E24)
    worksheet.write('A20', 'Bảng 1') # Image says Bảng 1 but refers to lookup table? Actually, image labels the bottom table as Bảng 1.
    ref_headers = ['MÃ DP', 'Tên Địa phương', 'Giá vé tàu xe (đồng)', 'CHI PHÍ LOẠI A', 'CHI PHÍ LOẠI B']
    for col, header in enumerate(ref_headers):
        worksheet.write(20, col, header, table_header_format)

    ref_data = [
        ['VT', 'Vũng Tàu', 50000, 200000, 300000],
        ['NT', 'Nha Trang', 100000, 250000, 350000],
        ['DL', 'Đà Lạt', 120000, 300000, 400000],
    ]
    for row_idx, row in enumerate(ref_data):
        for col_idx, val in enumerate(row):
            fmt = currency_format if col_idx >= 2 else cell_format
            worksheet.write(21 + row_idx, col_idx, val, fmt)

    # 4. Main Table Body (Rows 7-18 in sheet)
    data = [
        ['Lê Hải An', 'VTA'],
        ['Nguyễn Tấn Phát', 'NTB'],
        ['Trần Ngọc Bảo', 'DLB'],
        ['Nguyễn Thu Hà', 'DLA'],
        ['Nguyễn Văn Tâm', 'VTB'],
        ['Nguyễn Bảo Châu', 'VTA'],
        ['Lê Ngọc Tú', 'NTB'],
        ['Võ Thanh Thảo', 'VTB'],
        ['Chu Mạnh Quốc', 'DLB'],
        ['Nguyễn Ngọc Hải', 'NTA'],
        ['Lê Ngọc Nga', 'DLB'],
        ['Ngô Tùng', 'VTA'],
    ]

    for i, (name, code) in enumerate(data):
        row = 6 + i
        worksheet.write(row, 0, i + 1, center_format)
        worksheet.write(row, 1, name, cell_format)
        worksheet.write(row, 2, code, center_format)
        
        # Formulas using VLOOKUP or similar logic
        # Prefix = LEFT(C7, 2)
        # Suffix = RIGHT(C7, 1)
        
        prefix_formula = f"LEFT(C{row+1}, 2)"
        suffix_formula = f"RIGHT(C{row+1}, 1)"

        # Tên Địa phương (Col D)
        worksheet.write_formula(row, 3, f'=VLOOKUP({prefix_formula}, $A$22:$E$24, 2, FALSE)', cell_format)
        
        # Giá vé tàu xe (Col E)
        worksheet.write_formula(row, 4, f'=VLOOKUP({prefix_formula}, $A$22:$E$24, 3, FALSE)', currency_format)
        
        # Chi phí (Col F) - Depends on A or B
        worksheet.write_formula(row, 5, f'=IF({suffix_formula}="A", VLOOKUP({prefix_formula}, $A$22:$E$24, 4, FALSE), VLOOKUP({prefix_formula}, $A$22:$E$24, 5, FALSE))', currency_format)
        
        # Thu (Col G)
        worksheet.write_formula(row, 6, f'=E{row+1}+F{row+1}', currency_format)

    # Border for the entire main table area
    worksheet.conditional_format('A6:G18', {'type': 'no_errors', 'format': workbook.add_format({'border': 2})})

    workbook.close()
    print("Excel file 'Tourism_List.xlsx' created successfully.")

if __name__ == "__main__":
    create_excel()
