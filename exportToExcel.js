import ExcelJS from 'exceljs';
import fs from 'fs';
import { InputFile } from 'grammy';

const exportToExcel = async (chatId, products, ctx) => {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Товары');

      // Заголовки колонок
      const headers = ["Категория", "Бренд", "Модель", "Товар", "Цена"];
      worksheet.addRow(headers);

      // Стилизация заголовков
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true, size: 12, color: { argb: 'FFFFFF' } };
        cell.alignment = { horizontal: 'center', vertical: 'center' };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: '0070C0' }
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      let rowIndex = 2;

      Object.entries(products).forEach(([category, items]) => {
        // Добавляем заголовок категории
        const categoryRow = worksheet.addRow([category, '', '', '', '']);
        categoryRow.eachCell((cell, colNumber) => {
          cell.font = { bold: true, size: 12, color: { argb: 'FFFFFF' } };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: '002060' }
          };
          cell.alignment = { horizontal: 'center', vertical: 'center' };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
        rowIndex++;

        items.forEach(item => {
          const row = worksheet.addRow([category, item.brand, item.model, item.name, item.price]);
          row.eachCell((cell, colNumber) => {
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
          });
          rowIndex++;
        });

        // Добавляем пустую строку между категориями
        const emptyRow = worksheet.addRow(['', '', '', '', '']);
        emptyRow.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
        rowIndex++;
      });

      // Настройки ширины колонок
      worksheet.columns.forEach(column => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, cell => {
          const columnLength = cell.value ? cell.value.toString().length : 10;
          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });
        column.width = maxLength < 10 ? 10 : maxLength;
      });

      // Добавляем автофильтры
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: rowIndex - 1, column: 5 }
      };

      // Замораживаем первую строку
      worksheet.views = [
        { state: 'frozen', ySplit: 1 }
      ];

      // Имя файла
      const filename = "products.xlsx";
      await workbook.xlsx.writeFile(filename);

      // Отправляем файл в телеграм
      await ctx.replyWithDocument(new InputFile(filename), {
        caption: "Ваш файл с товарами готов!",
      });

      // Удаляем файл после отправки
      fs.unlinkSync(filename);
    } catch (error) {
      console.error("Ошибка при выгрузке в Excel:", error);
      sendMessage(ctx, "Произошла ошибка при выгрузке данных. Попробуйте позже.");
    }
  };

export default exportToExcel;
