import { Bot, Keyboard, InputFile, InlineKeyboard } from "grammy";
import { TOKEN, GROUP_ID, CATEGORIES, ITEMS_PER_PAGE_MARKUP } from './config.js';
import { fetchProducts } from './db.js';
import { sendMessage, sendMarkdown, formatProductsMessage } from './utils.js';
import * as XLSX from "xlsx";
import fs from "fs";

const bot = new Bot(TOKEN);



let previousProducts = {};
let userStates = {};
const subscribers = new Set();

// Обработка команды /start
bot.command("start", (ctx) => {
  const keyboard = new Keyboard()
    .text("Составить заказ")
    .row(...CATEGORIES.slice(0, 3))
    .row(...CATEGORIES.slice(3, 6))
    .row(...CATEGORIES.slice(6, 9))
    .row(...CATEGORIES.slice(9, 12))
    .row("📉 Изменение цен", "🔍 Найти товар")
    .row("📄 Выгрузить в Excel", "💼 Наценка на товар")
    .resized();

  sendMessage(ctx, "Выберите категорию товара или воспользуйтесь функциями:", {
    reply_markup: { keyboard: keyboard.build() },
  });
});

// Подписка/отписка
bot.command("subscribe", (ctx) => toggleSubscription(ctx.chat.id, true));
bot.command("unsubscribe", (ctx) => toggleSubscription(ctx.chat.id, false));

// Основной обработчик сообщений
bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;
  const state = userStates[chatId];

  if (state) {
    await handleUserState(chatId, text, state, ctx);
    return;
  }

  if (text === "Составить заказ") {
    userStates[chatId] = { state: "searching_product_for_order" };
    sendMessage(ctx, "Введите название товара для поиска:");
    return;
  }

  if (!CATEGORIES.includes(text) && !["📉 Изменение цен", "🔍 Найти товар", "📄 Выгрузить в Excel", "💼 Наценка на товар"].includes(text)) {
    sendMessage(ctx, "Пожалуйста, выберите категорию или функцию из списка.");
    return;
  }

  const products = await fetchProducts();
  if (!products) return;

  const actions = {
    "📉 Изменение цен": () => handlePriceChanges(chatId, products, ctx),
    "📄 Выгрузить в Excel": () => exportToExcel(chatId, products, ctx),
    "🔍 Найти товар": () => setUserState(chatId, "searching_product", ctx, "Введите название товара, который вы хотите найти:"),
    "💼 Наценка на товар": () => setUserState(chatId, "entering_product_name", ctx, "Введите название товара для расчета наценки:"),
  };

  if (actions[text]) {
    await actions[text]();
    return;
  }

  const productsMessage = formatProductsMessage(text, products);
  await sendMarkdown(ctx, productsMessage);
  previousProducts = products;
});

// Обработка callback-запросов
bot.on("callback_query:data", async (ctx) => {
  const chatId = ctx.chat.id;
  const data = ctx.callbackQuery.data;
  const state = userStates[chatId];

  // Обработка пагинации для поиска товаров в заказе
  if (data.startsWith("order_search_page_")) {
    const page = parseInt(data.replace("order_search_page_", ""));
    const { searchResults } = state;

    const totalPages = Math.ceil(searchResults.length / ITEMS_PER_PAGE_MARKUP);
    const startIndex = page * ITEMS_PER_PAGE_MARKUP;
    const endIndex = startIndex + ITEMS_PER_PAGE_MARKUP;
    const currentProducts = searchResults.slice(startIndex, endIndex);

    const inlineKeyboard = new InlineKeyboard();
    
    currentProducts.forEach(result => {
      inlineKeyboard.text(result.name, `select_product_for_order_${result.id}`).row(); // Используем ID товара
    });

    if (totalPages > 1) {
      if (page > 0) {
        inlineKeyboard.text("⬅️ Назад", `order_search_page_${page - 1}`);
      }
      if (page < totalPages - 1) {
        inlineKeyboard.text("➡️ Вперед", `order_search_page_${page + 1}`);
      }
    }

    await ctx.editMessageText(`Найдено несколько товаров. Выберите нужный (стр. ${page + 1}/${totalPages}):`, {
      reply_markup: inlineKeyboard,
    });
    await ctx.answerCallbackQuery();
    return;
  }

  // Обработка выбора товара для заказа
  if (data.startsWith("select_product_for_order_")) {
    const productId = data.replace("select_product_for_order_", "");
    const { searchResults } = userStates[chatId];
    const selectedProduct = searchResults.find(item => item.id === parseInt(productId)); // Ищем товар по ID

    if (selectedProduct) {
      userStates[chatId] = {
        state: "selecting_payment",
        selectedProduct,
      };

      const inlineKeyboard = new InlineKeyboard()
        .text("Предоплата", "payment_Предоплата")
        .text("Наличные", "payment_Наличные")
        .text("Карта", "payment_Карта");

      sendMessage(ctx, "Выберите способ оплаты:", {
        reply_markup: inlineKeyboard,
      });
    }
  }

  // Обработка пагинации категорий
  if (data.startsWith("category_")) {
    const parts = data.split('_');
    const categoryName = parts[1];
    const page = parseInt(parts[2] || 0);
    
    const products = await fetchProducts();
    if (!products) return;

    const categoryKey = CATEGORY_MAPPING[categoryName];
    const categoryProducts = products[categoryKey] || [];
    
    if (!categoryProducts.length) {
      sendMessage(ctx, `Товары в категории "${categoryName}" не найдены.`);
      return;
    }

    const totalPages = Math.ceil(categoryProducts.length / ITEMS_PER_PAGE);
    const startIndex = page * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const currentProducts = categoryProducts.slice(startIndex, endIndex);

    const inlineKeyboard = new InlineKeyboard();
    
    currentProducts.forEach(product => {
      inlineKeyboard.text(product.name, `order_product_${product.id}`).row(); // Используем ID товара
    });

    if (page > 0) {
      inlineKeyboard.text("⬅️ Назад", `category_${categoryName}_${page - 1}`);
    }
    if (page < totalPages - 1) {
      inlineKeyboard.text("➡️ Вперед", `category_${categoryName}_${page + 1}`);
    }

    await ctx.editMessageText(`Товары в категории "${categoryName}" (стр. ${page + 1}/${totalPages}):`, {
      reply_markup: inlineKeyboard,
    });
    await ctx.answerCallbackQuery();
    return;
  }

  // Обработка выбора способа оплаты
  if (data.startsWith("payment_")) {
    const paymentMethod = data.replace("payment_", "");
    userStates[chatId].paymentMethod = paymentMethod;
    userStates[chatId].state = "entering_fio";

    sendMessage(ctx, "Введите ваше ФИО:");
  }

  // Обработка выбора магазина
  if (data.startsWith("shop_")) {
    const shop = data.replace("shop_", "");
    userStates[chatId].shop = shop;
    userStates[chatId].state = "entering_comment";

    sendMessage(ctx, "Введите комментарий к заказу:");
  }

  // Обработка выбора товара для наценки
  if (data.startsWith("select_product_for_markup_")) {
    const productId = data.replace("select_product_for_markup_", "");
    const { searchResults } = userStates[chatId];
    const selectedProduct = searchResults.find(item => item.id === parseInt(productId)); // Ищем товар по ID

    if (selectedProduct) {
      userStates[chatId] = {
        state: "entering_markup_percentage",
        selectedProduct,
      };
      sendMessage(ctx, "Введите процент наценки (например, 10):");
    }
  }

  await ctx.answerCallbackQuery();
});

// Обработка состояний пользователя
const setUserState = (chatId, state, ctx, prompt, data = {}) => {
  userStates[chatId] = { state, ...data };
  sendMessage(ctx, prompt);
};

const handleUserState = async (chatId, text, state, ctx) => {
  const actions = {
    // Обработчик для поиска товара (для кнопки "🔍 Найти товар")
    searching_product: async () => {
      const products = await fetchProducts();
      if (!products) return;

      const results = Object.entries(products)
        .flatMap(([category, items]) =>
          items.filter(item => item.name.toLowerCase().includes(text.toLowerCase().trim()))
            .map(item => ({ category, ...item }))
        );

      if (!results.length) {
        sendMessage(ctx, `Товар "${text}" не найден.`);
        delete userStates[chatId];
        return;
      }

      let message = "Результаты поиска:\n\n";
      results.forEach((result, index) => {
        message += `${index + 1}. *${result.name}*\n`;
        message += `- Категория: ${result.category}\n`;
        message += `- Цена: ${result.price} ₽\n\n`;
      });

      await sendMarkdown(ctx, message);
      delete userStates[chatId];
    },

    // Обработчик для поиска товара (для функции "Составить заказ")
    searching_product_for_order: async () => {
      const products = await fetchProducts();
      if (!products) return;

      const results = Object.entries(products)
        .flatMap(([category, items]) =>
          items.filter(item => item.name.toLowerCase().includes(text.toLowerCase().trim()))
            .map(item => ({ category, ...item }))
        );

      if (!results.length) {
        sendMessage(ctx, `Товар "${text}" не найден.`);
        delete userStates[chatId];
        return;
      }

      // Пагинация
      const totalPages = Math.ceil(results.length / ITEMS_PER_PAGE_MARKUP);
      const currentPage = 0; // Начинаем с первой страницы

      const startIndex = currentPage * ITEMS_PER_PAGE_MARKUP;
      const endIndex = startIndex + ITEMS_PER_PAGE_MARKUP;
      const currentProducts = results.slice(startIndex, endIndex);

      const inlineKeyboard = new InlineKeyboard();
      
      currentProducts.forEach(result => {
        inlineKeyboard.text(result.name, `select_product_for_order_${result.id}`).row(); // Используем ID товара
      });

      if (totalPages > 1) {
        if (currentPage > 0) {
          inlineKeyboard.text("⬅️ Назад", `order_search_page_${currentPage - 1}`);
        }
        if (currentPage < totalPages - 1) {
          inlineKeyboard.text("➡️ Вперед", `order_search_page_${currentPage + 1}`);
        }
      }

      sendMessage(ctx, `Найдено несколько товаров. Выберите нужный (стр. ${currentPage + 1}/${totalPages}):`, {
        reply_markup: inlineKeyboard,
      });

      // Сохраняем результаты поиска и текущую страницу в состоянии пользователя
      userStates[chatId] = {
        state: "selecting_product_for_order",
        searchResults: results,
        currentPage,
      };
    },

    // Обработчик для ввода процента наценки
    entering_markup_percentage: () => calculateMarkup(chatId, text, state, ctx),

    // Обработчик для ввода ФИО
    entering_fio: () => {
      userStates[chatId].fio = text;
      userStates[chatId].state = "selecting_shop";

      const inlineKeyboard = new InlineKeyboard()
        .text("Магазин 1", "shop_Магазин 1")
        .text("Магазин 2", "shop_Магазин 2");

      sendMessage(ctx, "Выберите магазин:", {
        reply_markup: inlineKeyboard,
      });
    },

    // Обработчик для ввода комментария
    entering_comment: () => {
      userStates[chatId].comment = text;
      sendOrderToGroup(chatId, userStates[chatId], ctx);
    },
  };

  if (actions[state.state]) {
    await actions[state.state]();
    return;
  }

  delete userStates[chatId];
  sendMessage(ctx, "Произошла ошибка. Попробуйте снова.");
};

// Функция для расчета наценки
const calculateMarkup = async (chatId, markupText, state, ctx) => {
  const markup = parseFloat(markupText);
  if (isNaN(markup) || markup < 0) {
    sendMessage(ctx, "Некорректная наценка. Пожалуйста, введите число (например, 10).");
    return;
  }

  const { selectedProduct } = state;
  const newPrice = selectedProduct.price * (1 + markup / 100);

  sendMessage(
    ctx,
    `Товар: ${selectedProduct.name}\n` +
    `Старая цена: ${selectedProduct.price} ₽\n` +
    `Наценка: ${markup}%\n` +
    `Новая цена: ${newPrice.toFixed(2)} ₽`
  );

  delete userStates[chatId];
};

// Дополнительные функции
const toggleSubscription = (chatId, isSubscribing) => {
  isSubscribing ? subscribers.add(chatId) : subscribers.delete(chatId);
  bot.api.sendMessage(chatId, isSubscribing ? "Вы подписались на уведомления." : "Вы отписались от уведомлений.");
};

const exportToExcel = async (chatId, products, ctx) => {
  try {
    const data = [];
    Object.entries(products).forEach(([category, items]) => {
      items.forEach(item => {
        data.push({
          Категория: category,
          Товар: item.name,
          Цена: item.price,
        });
      });
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Товары");

    const filename = "products.xlsx";
    XLSX.writeFile(workbook, filename);

    await ctx.replyWithDocument(new InputFile(filename), {
      caption: "Ваш файл с товарами готов!",
    });

    fs.unlinkSync(filename);
  } catch (error) {
    console.error("Ошибка при выгрузке в Excel:", error);
    sendMessage(ctx, "Произошла ошибка при выгрузке данных. Попробуйте позже.");
  }
};

const handlePriceChanges = async (chatId, products, ctx) => {
  try {
    if (!previousProducts || Object.keys(previousProducts).length === 0) {
      previousProducts = products;
      sendMessage(ctx, "Изменения цен пока не обнаружены.");
      return;
    }

    let changesDetected = false;
    let message = "Изменения цен:\n\n";

    Object.entries(products).forEach(([category, items]) => {
      items.forEach(item => {
        const previousItem = previousProducts[category]?.find(prevItem => prevItem.name === item.name);
        if (previousItem && previousItem.price !== item.price) {
          changesDetected = true;
          message += `*${item.name}*:\n`;
          message += `- Старая цена: ${previousItem.price} ₽\n`;
          message += `- Новая цена: ${item.price} ₽\n\n`;
        }
      });
    });

    if (!changesDetected) {
      sendMessage(ctx, "Изменения цен не обнаружены.");
    } else {
      const threadId = -1002301146731;
      await bot.api.sendMessage(GROUP_ID, message, {
        message_thread_id: threadId,
        parse_mode: "Markdown",
      });

      sendMarkdown(ctx, message);
    }

    previousProducts = products;
  } catch (error) {
    console.error("Ошибка при обработке изменений цен:", error);
    sendMessage(ctx, "Произошла ошибка при проверке изменений цен. Попробуйте позже.");
  }
};

const sendOrderToGroup = async (chatId, state, ctx) => {
  const { selectedProduct, paymentMethod, fio, shop, comment } = state;

  const orderMessage = 
`1. Товар: ${selectedProduct.name}
Цена: ${selectedProduct.price} ₽
Оплата: ${paymentMethod}
ФИО: ${fio}
Магазин: ${shop}
Комментарий: ${comment}`;

  try {
    await bot.api.sendMessage(GROUP_ID, orderMessage);
    sendMessage(ctx, "Заказ успешно отправлен в группу.");
  } catch (error) {
    console.error("Ошибка при отправке заказа в группу:", error);
    sendMessage(ctx, "Ошибка при отправке заказа. Пожалуйста, попробуйте снова.");
  } finally {
    delete userStates[chatId];
  }
};

// Обработка ошибок
bot.catch((err) => {
  console.error("Ошибка в боте:", err);
});



bot.start();

export { bot };