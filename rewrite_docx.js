const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak } = require('docx');
const fs = require('fs');

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Times New Roman", size: 28 } } }, // 14pt default for typical essays
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Times New Roman" },
        paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 360, after: 360 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Times New Roman" },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, italic: true, font: "Times New Roman" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 2 } },
      { id: "NormalBody", name: "NormalBody", basedOn: "Normal",
        paragraph: { spacing: { before: 120, after: 120, line: 360 }, alignment: AlignmentType.JUSTIFIED, indent: { firstLine: 720 } } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1701 } // Standard margins
      }
    },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "BỘ GIÁO DỤC VÀ ĐÀO TẠO", size: 28 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "TRƯỜNG ĐẠI HỌC HOA SEN", size: 28, bold: true })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "---------------------------", size: 28 })] }),
      new Paragraph({ children: [new TextRun("")] }),
      new Paragraph({ children: [new TextRun("")] }),
      new Paragraph({ children: [new TextRun("")] }),
      new Paragraph({ children: [new TextRun("")] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "BÀI TIỂU LUẬN CUỐI KỲ", size: 36, bold: true })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "MÔN TRIẾT HỌC MÁC - LÊNIN", size: 32, bold: true })] }),
      new Paragraph({ children: [new TextRun("")] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "CHỦ ĐỀ: QUÁ TRÌNH SẢN XUẤT TƯ BẢN CHỦ NGHĨA. SỰ VẬN DỤNG VÀO CÔNG CUỘC CÔNG NGHIỆP HÓA – HIỆN ĐẠI HÓA Ở NƯỚC TA HIỆN NAY.", size: 28, bold: true })] }),
      new Paragraph({ children: [new TextRun("")] }),
      new Paragraph({ children: [new TextRun("")] }),
      new Paragraph({ children: [new TextRun("")] }),
      new Paragraph({ children: [new TextRun({ text: "HỌ VÀ TÊN HỌC VIÊN: HỨA THANH NAM", bold: true })] }),
      new Paragraph({ children: [new TextRun("Mã số SV: 22503879")] }),
      new Paragraph({ children: [new TextRun("Ngành: Ngôn ngữ Anh")] }),
      new Paragraph({ children: [new TextRun("Lớp MH: DC141DL01-1014")] }),
      new Paragraph({ children: [new TextRun("Giảng viên phụ trách: ThS. Nguyễn Dạ Thu")] }),
      new Paragraph({ children: [new TextRun("")] }),
      new Paragraph({ children: [new TextRun("")] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Tp. Hồ Chí Minh, Tháng 5 năm 2026", italic: true })] }),
      
      new Paragraph({ children: [new PageBreak()] }),
      
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("LỜI CAM ĐOAN")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Em xin cam đoan đây là bài tiểu luận do chính em tự tìm hiểu và thực hiện dựa trên các kiến thức đã học trên lớp cũng như sự hướng dẫn của giảng viên ThS. Nguyễn Dạ Thu. Các nguồn tài liệu tham khảo đều được em trích dẫn và ghi chú rõ ràng ở phần cuối bài. Bài làm không có sự sao chép trái phép hay vi phạm các nguyên tắc liêm chính học thuật. Em hoàn toàn chịu trách nhiệm về tính trung thực của bài làm này.")] }),
      
      new Paragraph({ children: [new PageBreak()] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("PHẦN MỞ ĐẦU")] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Lý do chọn đề tài")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Trong quá trình học môn Triết học Mác - Lênin, em đặc biệt ấn tượng với học thuyết hình thái kinh tế - xã hội của C. Mác, nhất là quy luật về sự phù hợp của quan hệ sản xuất với trình độ phát triển của lực lượng sản xuất. Có thể nói đây là chìa khóa để hiểu được sự vận động của lịch sử nhân loại. Nhìn vào thực tế, bất kỳ sự thay đổi nào của xã hội cũng bắt nguồn từ nền tảng kinh tế, từ cách con người tổ chức sản xuất.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Ở Việt Nam, quy luật này không chỉ là những dòng lý thuyết khô khan trên giấy. Nếu nhìn lại giai đoạn trước năm 1986 thời bao cấp, chúng ta có thể thấy khá rõ hậu quả của việc áp đặt một quan hệ sản xuất quá nóng vội trong khi điều kiện cơ sở vật chất, công cụ lao động còn nghèo nàn. Bài học từ thời kỳ đó cho thấy việc vận dụng sai quy luật sẽ khiến nền kinh tế bị đình trệ. Nhờ có công cuộc Đổi mới, Đảng và Nhà nước đã điều chỉnh lại cho phù hợp, chấp nhận nhiều thành phần kinh tế và thúc đẩy quá trình công nghiệp hóa, hiện đại hóa. Những sự thay đổi này diễn ra ngay trong đời sống hàng ngày mà bản thân những sinh viên như chúng ta có thể dễ dàng nhận thấy. Vì vậy, em quyết định chọn đề tài này để cố gắng tìm hiểu sâu hơn về lý luận, cũng như cách nó đang được áp dụng vào thực tiễn phát triển kinh tế đất nước hiện nay.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Mục đích và phạm vi nghiên cứu")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Mục đích của bài tiểu luận là phân tích những cơ sở lý thuyết cốt lõi của quy luật quan hệ sản xuất và lực lượng sản xuất, từ đó liên hệ với quá trình công nghiệp hóa, hiện đại hóa ở Việt Nam.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Bài viết tập trung vào hai nhiệm vụ chính: thứ nhất là làm rõ các khái niệm và mối quan hệ biện chứng giữa chúng; thứ hai là nhìn lại một số giai đoạn lịch sử của nước ta (trước và sau Đổi mới) để thấy cách Đảng vận dụng quy luật này vào thực tế, đặc biệt là trong bối cảnh phát triển công nghệ hiện nay ở các khu vực kinh tế trọng điểm như TP.HCM.")] }),

      new Paragraph({ children: [new PageBreak()] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("PHẦN NỘI DUNG")] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Chương 1: Cơ sở lý thuyết")] }),
      new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("1.1. Lực lượng sản xuất (LLSX)")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Lực lượng sản xuất thực chất là năng lực thực tiễn của con người trong quá trình cải tạo tự nhiên để tạo ra của cải vật chất. Nói cách khác, nó thể hiện mối quan hệ giữa con người với tự nhiên. Theo lý luận Mác - Lênin, LLSX được tạo thành từ hai thành phần chính: người lao động và tư liệu sản xuất.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Người lao động được xem là yếu tố quan trọng nhất. Dù máy móc hay công nghệ có hiện đại đến đâu, nếu không có con người vận hành và cải tiến thì chúng cũng chỉ là những cỗ máy vô tri vô giác. Người lao động ở đây không chỉ đóng góp bằng sức mạnh cơ bắp mà quan trọng hơn là bằng trí tuệ, kỹ năng và kinh nghiệm tích lũy được trong quá trình làm việc.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Tư liệu sản xuất bao gồm đối tượng lao động (như đất đai, khoáng sản, vật liệu) và tư liệu lao động (công cụ, máy móc, nhà xưởng). Trong số đó, công cụ lao động là yếu tố dễ thay đổi nhất và cũng mang tính cách mạng nhất. Nhìn lại lịch sử, sự chuyển đổi từ đồ đá sang đồ đồng, đồ sắt, rồi đến sự ra đời của máy hơi nước và ngày nay là kỷ nguyên của công nghệ số và trí tuệ nhân tạo (AI), mỗi lần công cụ lao động thay đổi là một lần xã hội loài người lại bước sang một trang mới, kéo theo năng suất lao động tăng vọt.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Đặc biệt trong thời đại ngày nay, khoa học công nghệ đã trở thành một lực lượng sản xuất trực tiếp. Tri thức khoa học không còn nằm trên sách vở mà được ứng dụng ngay vào máy móc và quy trình sản xuất thực tế, làm thay đổi hoàn toàn cách chúng ta tổ chức công việc và làm việc hàng ngày.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("1.2. Quan hệ sản xuất (QHSX)")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Nếu LLSX là mối quan hệ giữa người với tự nhiên thì QHSX chính là mối quan hệ giữa con người với nhau trong quá trình sản xuất đó. QHSX thường được xem xét qua ba khía cạnh: sở hữu tư liệu sản xuất, tổ chức quản lý và phân phối sản phẩm.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Trong ba khía cạnh này, quan hệ sở hữu đóng vai trò quyết định. Hiểu đơn giản, ai nắm trong tay những tư liệu sản xuất chủ yếu thì người đó sẽ có quyền quyết định cách thức tổ chức công việc và cách chia sẻ lợi ích tạo ra. Trong khi đó, quan hệ tổ chức quản lý và phân phối thì có tác động trực tiếp và rõ ràng nhất đến động lực của người lao động. Một cơ chế phân phối công bằng, minh bạch thì người lao động mới có động lực cống hiến; ngược lại, nếu duy trì tư duy cào bằng hay xảy ra sự bất công thì sẽ làm triệt tiêu sự nhiệt tình và khả năng sáng tạo của họ.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("1.3. Mối quan hệ biện chứng")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("LLSX và QHSX là hai mặt không thể tách rời, cùng nhau tạo nên phương thức sản xuất của xã hội. Trong mối quan hệ này, LLSX là yếu tố mang tính quyết định. LLSX thì luôn vận động và phát triển không ngừng vì con người luôn muốn cải tiến công cụ để làm việc nhàn hơn, năng suất hơn. Trong khi đó, QHSX lại có xu hướng ổn định hơn một chút vì nó bị ràng buộc bởi các thể chế, chính sách và quyền lợi nhóm.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Khi LLSX phát triển mạnh mẽ đến một mức nào đó, nó sẽ vượt ra khỏi khuôn khổ của QHSX cũ. Lúc này, QHSX cũ từ chỗ là một môi trường hỗ trợ sẽ dần biến thành rào cản. Khi đó, tất yếu phải có sự thay đổi QHSX để có thể dọn đường cho LLSX tiếp tục tiến lên.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Ngược lại, QHSX cũng có sự tác động ngược trở lại rất lớn. Nếu nó được thiết kế phù hợp, nó sẽ là một bệ phóng giúp LLSX bứt phá. Còn nếu nó lạc hậu (đi quá chậm) hoặc bị áp đặt phải tiên tiến một cách gượng ép (đi quá nhanh so với thực tế), nó sẽ giống như một chiếc áo không vừa, kéo lùi sự phát triển chung của nền kinh tế.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Chương 2: Sự vận dụng ở Việt Nam")] }),
      new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("2.1. Nhìn lại giai đoạn trước Đổi mới (1986)")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Sau năm 1975, đất nước bước vào công cuộc xây dựng với một nền kinh tế có xuất phát điểm rất thấp, chủ yếu là nông nghiệp thủ công, lại thêm hậu quả nặng nề mà chiến tranh để lại. Lúc bấy giờ, do mong muốn có thể nhanh chóng tiến lên chủ nghĩa xã hội, chúng ta đã vội vã áp dụng mô hình quản lý tập trung quan liêu, bao cấp và tiến hành ồ ạt quá trình tập thể hóa.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Dưới góc độ triết học, đây là một bước đi chưa phù hợp khi cố gắng áp đặt một QHSX quá lý tưởng (với hình thức sở hữu toàn dân và tập thể quy mô lớn) lên một LLSX còn quá non kém (khi mà công cụ lao động ở nông thôn lúc đó chủ yếu vẫn chỉ là cái cày, cái cuốc). Việc thiết kế một chiếc áo QHSX quá rộng so với thực tế cơ thể LLSX đã dẫn đến việc triệt tiêu động lực làm việc cá nhân. Tình trạng ỷ lại, thiếu trách nhiệm xuất hiện khá phổ biến trong các hợp tác xã nông nghiệp thời kỳ đó. Hàng hóa trở nên khan hiếm và sản xuất bị đình trệ. Nhận ra điều này, Đại hội VI của Đảng (năm 1986) đã có những bước nhìn nhận lại thẳng thắn để từ đó đưa ra đường lối Đổi mới, mở cửa chấp nhận phát triển một nền kinh tế nhiều thành phần.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("2.2. Phát triển LLSX thông qua quá trình CNH, HĐH")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Kể từ khi bắt đầu Đổi mới, Đảng ta xác định rất rõ rằng muốn vực dậy nền kinh tế thì phải tập trung nâng cấp LLSX. Giải pháp cụ thể là đẩy mạnh công nghiệp hóa, hiện đại hóa gắn liền với việc chú trọng phát triển nguồn nhân lực chất lượng cao.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Ở khía cạnh con người, giáo dục đào tạo được coi là quốc sách. Xã hội hiện nay không chỉ cần lao động tay chân mà nhu cầu về lao động có kỹ năng, tay nghề cao, đặc biệt trong mảng công nghệ thông tin đang ngày càng trở nên cấp thiết.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Về mặt công cụ lao động, chúng ta đang chứng kiến sự thay đổi rất rõ rệt ở nhiều địa phương. Lấy ví dụ ngay tại TP.HCM, sự hình thành và phát triển của Khu Công nghệ cao (SHTP) ở Thủ Đức là một ví dụ thực tế cho việc thu hút các tập đoàn lớn như Intel, Nidec hay Samsung. Sự hiện diện của những ông lớn này không chỉ mang lại nguồn vốn đầu tư mà còn đưa vào Việt Nam những dây chuyền công nghệ và máy móc hiện đại. Bản thân các công ty công nghệ trong nước như FPT Software, TMA hay VNG cũng đang không ngừng nâng cấp công cụ làm việc của mình, áp dụng tự động hóa vào quy trình quản lý và phát triển phần mềm. Đó chính là quá trình cách mạng hóa công cụ lao động đang diễn ra ngay trong đời sống thực tiễn.")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("2.3. Từng bước điều chỉnh QHSX cho phù hợp")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Đi cùng với sự phát triển nhanh chóng của LLSX, QHSX cũng được Nhà nước điều chỉnh linh hoạt hơn để không bị trở thành yếu tố kìm hãm nền kinh tế.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Về vấn đề sở hữu, thay vì chỉ có kinh tế nhà nước và tập thể như trước kia, chúng ta đã cởi mở hơn rất nhiều với kinh tế tư nhân và khu vực kinh tế có vốn đầu tư nước ngoài (FDI). Trên thực tế, khối kinh tế tư nhân hiện nay đã trở thành một trụ cột quan trọng tạo ra nhiều công ăn việc làm nhất cho xã hội. Sự nở rộ của các công ty khởi nghiệp (startups) ở TP.HCM là một luồng gió mới, nơi mà các bạn trẻ có thể tự làm chủ các ý tưởng và sản phẩm của mình, thoát khỏi sự gò bó của các mô hình kinh tế cũ.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Về khâu quản lý và phân phối, cơ chế xin-cho đã dần được thay thế. Thị trường đóng vai trò ngày càng lớn trong việc quyết định giá cả và phân bổ nguồn lực. Việc phân phối sản phẩm cũng được thực hiện sát với nguyên tắc đóng góp nhiều thì hưởng nhiều, kết hợp với các phúc lợi xã hội cơ bản. Tại các công ty hay tập đoàn hiện nay, những chính sách thưởng theo năng suất (KPIs) hay việc chia cổ phần ưu đãi cho nhân viên chính là cách tổ chức phân phối linh hoạt, giúp giữ chân người tài và tạo ra động lực thực sự cho những người lao động trực tiếp làm ra của cải.")] }),

      new Paragraph({ children: [new PageBreak()] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("PHẦN KẾT LUẬN")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Tóm lại, quy luật về sự phù hợp giữa quan hệ sản xuất và trình độ phát triển của lực lượng sản xuất tuy là một nguyên lý mang tính triết học nhưng lại có giá trị thực tiễn vô cùng lớn. Việc hiểu đúng và hành động thuận theo quy luật này sẽ giúp nền kinh tế có đà đi lên; ngược lại, bất kỳ sự chủ quan hay nóng vội nào cũng sẽ dẫn đến những bước lùi không đáng có.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Nhìn lại chặng đường Đổi mới của nước ta, có thể thấy khá rõ những bước chuyển mình tích cực nhờ vào việc Đảng và Nhà nước đã biết cách linh hoạt điều chỉnh các chính sách kinh tế. Quyết định cởi trói cho khu vực kinh tế tư nhân, mở cửa thu hút đầu tư nước ngoài và thúc đẩy ứng dụng công nghệ (như làn sóng chuyển đổi số hiện nay) chính là những bước đi thiết thực nhất để giải phóng và phát huy sức mạnh của lực lượng sản xuất.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("Bản thân là một sinh viên đang theo học trên ghế nhà trường, em nhận thấy việc nắm vững quy luật này không chỉ đơn thuần là để phục vụ cho môn học. Nó còn giúp em có được một cái nhìn thực tế hơn về thị trường lao động. Khi lực lượng sản xuất ngày càng yêu cầu cao hơn về mặt công nghệ và khả năng tư duy sáng tạo, những người lao động tương lai (mà cụ thể là thế hệ trẻ chúng em) sẽ phải chủ động tự nâng cấp kỹ năng và kiến thức của mình, để có thể thích ứng và không bị đào thải khỏi guồng quay hối hả của quá trình công nghiệp hóa, hiện đại hóa.")] }),

      new Paragraph({ children: [new PageBreak()] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("TÀI LIỆU THAM KHẢO")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("1. Bộ Giáo dục và Đào tạo, Giáo trình Triết học Mác - Lênin (Dành cho bậc đại học hệ không chuyên lý luận chính trị), Nxb. Chính trị quốc gia Sự thật, Hà Nội.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("2. Đảng Cộng sản Việt Nam (1986), Văn kiện Đại hội đại biểu toàn quốc lần thứ VI, Nxb. Sự thật, Hà Nội.")] }),
      new Paragraph({ style: "NormalBody", children: [new TextRun("3. Đảng Cộng sản Việt Nam (2021), Văn kiện Đại hội đại biểu toàn quốc lần thứ XIII, Tập I, Nxb. Chính trị quốc gia Sự thật, Hà Nội.")] })
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("C:/Users/Admin/Documents/HUA THANH NAM - THML.docx", buffer);
  console.log("Document generated successfully!");
}).catch(err => {
  console.error("Error generating document:", err);
});
