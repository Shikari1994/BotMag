import { Bot, Keyboard, InputFile, InlineKeyboard } from "grammy";
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import 'dotenv/config';
import exportToExcel from './exportToExcel.js'; // Импортируем функцию

const TOKEN = process.env.TOKEN;
const GROUP_ID = -1002301146731;
const bot = new Bot(TOKEN);
const ITEMS_PER_PAGE = 10;
const ITEMS_PER_PAGE_MARKUP = 8; // Количество товаров на странице для наценки

const dbPromise = open({
  filename: 'products.db',
  driver: sqlite3.Database,
});

const CATEGORIES = [
  "Часы", "Смартфоны", "Игровые приставки и геймпады",
  "Наушники", "Планшеты", "Ноутбуки", "Колонки",
  "Красота", "Аксессуары Apple", "Аксессуары Samsung"
];

const CATEGORY_MAPPING = {
  "Часы": "Часы",
  "Смартфоны": "Смартфоны",
  "Игровые приставки и геймпады": "Игровые приставки и геймпады",
  "Наушники": "Наушники",
  "Планшеты": "Планшеты",
  "Ноутбуки": "Ноутбуки",
  "Колонки": "Колонки",
  "Красота": "Красота",
  "Аксессуары Apple": "Аксессуары Apple",
  "Аксессуары Samsung": "Аксессуары Samsung"
};

let previousProducts = {};
let userStates = {};
const subscribers = new Set();
const MAX_MESSAGE_LENGTH = 4096;

// Вспомогательные функции
const sendLongMessage = async (ctx, text, options = {}) => {
  for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
    const chunk = text.substring(i, i + MAX_MESSAGE_LENGTH);
    await ctx.reply(chunk, { ...options, parse_mode: "Markdown" });
  }
};

const sendMessage = (ctx, text, options = {}) => ctx.reply(text, options);
const sendMarkdown = (ctx, text) => sendLongMessage(ctx, text, { parse_mode: "Markdown" });

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
    "📄 Выгрузить в Excel": () => exportToExcel(chatId, products, ctx), // Используем импортированную функцию
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

  if (data.startsWith("order_search_page_") || data.startsWith("markup_search_page_")) {
    await handlePagination(ctx, data, state);
    return;
  }

  if (data.startsWith("select_product_for_order_")) {
    await handleProductSelection(ctx, data, "selecting_payment");
    return;
  }

  if (data.startsWith("select_product_for_markup_")) {
    await handleProductSelection(ctx, data, "entering_markup_percentage");
    return;
  }

  if (data.startsWith("payment_")) {
    await handlePaymentSelection(ctx, data);
    return;
  }

  if (data.startsWith("shop_")) {
    await handleShopSelection(ctx, data);
    return;
  }

  await ctx.answerCallbackQuery();
});

// Функции работы с данными
const fetchProducts = async () => {
  const db = await dbPromise;
  const rows = await db.all('SELECT id, category, brand, model, name, price FROM products');
  const products = {};

  rows.forEach(row => {
    if (!products[row.category]) {
      products[row.category] = [];
    }
    products[row.category].push({
      id: row.id,
      brand: row.brand,
      model: row.model,
      name: row.name,
      price: row.price
    });
  });

  return products;
};

const formatProductsMessage = (category, products) => {
  const apiCategory = CATEGORY_MAPPING[category];
  const categoryProducts = products[apiCategory] || [];

  if (!categoryProducts.length) return `Товары для категории "${category}" не найдены.`;

  let message = `*${apiCategory}*:\n`;
  const groupedByBrand = groupByBrand(categoryProducts);
  Object.entries(groupedByBrand).forEach(([brand, brandItems]) => {
    message += `_${brand}_\n`;
    message += brandItems.map(item => `- ${item.name}: ${item.price} ₽`).join("\n");
    message += "\n\n";
  });

  return message;
};

const groupByBrand = (items) => {
  return items.reduce((acc, item) => {
    if (!acc[item.brand]) {
      acc[item.brand] = [];
    }
    acc[item.brand].push(item);
    return acc;
  }, {});
};

// Обработка состояний пользователя
const setUserState = (chatId, state, ctx, prompt, data = {}) => {
  userStates[chatId] = { state, ...data };
  sendMessage(ctx, prompt);
};

const handleUserState = async (chatId, text, state, ctx) => {
  const actions = {
    searching_product: async () => await searchProduct(chatId, text, ctx),
    searching_product_for_order: async () => handleProductSearch(chatId, text, ctx, "searching_product_for_order"),
    entering_markup_percentage: () => calculateMarkup(chatId, text, state, ctx),
    entering_fio: () => handleFIO(chatId, text, ctx),
    entering_comment: () => handleComment(chatId, text, ctx),
    entering_product_name: async () => handleProductSearch(chatId, text, ctx, "entering_product_name"),
  };

  if (actions[state.state]) {
    await actions[state.state]();
    return;
  }

  delete userStates[chatId];
  sendMessage(ctx, "Произошла ошибка. Попробуйте снова.");
};

const searchProduct = async (chatId, text, ctx) => {
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
};

const handleProductSearch = async (chatId, text, ctx, actionType) => {
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

  const totalPages = Math.ceil(results.length / ITEMS_PER_PAGE_MARKUP);
  const currentPage = 0;

  const startIndex = currentPage * ITEMS_PER_PAGE_MARKUP;
  const endIndex = startIndex + ITEMS_PER_PAGE_MARKUP;
  const currentProducts = results.slice(startIndex, endIndex);

  const inlineKeyboard = new InlineKeyboard();

  currentProducts.forEach(result => {
    inlineKeyboard.text(result.name, `select_product_for_${actionType === "searching_product_for_order" ? "order" : "markup"}_${result.id}`).row();
  });

  if (totalPages > 1) {
    if (currentPage > 0) {
      inlineKeyboard.text("⬅️ Назад", `${actionType === "searching_product_for_order" ? "order" : "markup"}_search_page_${currentPage - 1}`);
    }
    if (currentPage < totalPages - 1) {
      inlineKeyboard.text("➡️ Вперед", `${actionType === "searching_product_for_order" ? "order" : "markup"}_search_page_${currentPage + 1}`);
    }
  }

  sendMessage(ctx, `Найдено несколько товаров. Выберите нужный (стр. ${currentPage + 1}/${totalPages}):`, {
    reply_markup: inlineKeyboard,
  });

  userStates[chatId] = {
    state: actionType === "searching_product_for_order" ? "selecting_product_for_order" : "selecting_product_for_markup",
    searchResults: results,
    currentPage,
  };
};

const handlePagination = async (ctx, data, state) => {
  const chatId = ctx.chat.id;
  const page = parseInt(data.split('_').pop());
  const { searchResults } = state;

  const totalPages = Math.ceil(searchResults.length / ITEMS_PER_PAGE_MARKUP);
  const startIndex = page * ITEMS_PER_PAGE_MARKUP;
  const endIndex = startIndex + ITEMS_PER_PAGE_MARKUP;
  const currentProducts = searchResults.slice(startIndex, endIndex);

  const inlineKeyboard = new InlineKeyboard();

  currentProducts.forEach(result => {
    inlineKeyboard.text(result.name, `select_product_for_${data.startsWith("order") ? "order" : "markup"}_${result.id}`).row();
  });

  if (totalPages > 1) {
    if (page > 0) {
      inlineKeyboard.text("⬅️ Назад", `${data.startsWith("order") ? "order" : "markup"}_search_page_${page - 1}`);
    }
    if (page < totalPages - 1) {
      inlineKeyboard.text("➡️ Вперед", `${data.startsWith("order") ? "order" : "markup"}_search_page_${page + 1}`);
    }
  }

  await ctx.editMessageText(`Найдено несколько товаров. Выберите нужный (стр. ${page + 1}/${totalPages}):`, {
    reply_markup: inlineKeyboard,
  });
  await ctx.answerCallbackQuery();
};

const handleProductSelection = async (ctx, data, nextState) => {
  const chatId = ctx.chat.id;
  const productId = data.split('_').pop();
  const { searchResults } = userStates[chatId];
  const selectedProduct = searchResults.find(item => item.id === parseInt(productId));

  if (selectedProduct) {
    userStates[chatId] = {
      state: nextState,
      selectedProduct,
    };

    if (nextState === "selecting_payment") {
      const inlineKeyboard = new InlineKeyboard()
        .text("Предоплата", "payment_Предоплата")
        .text("Наличные", "payment_Наличные")
        .text("Карта", "payment_Карта");

      sendMessage(ctx, "Выберите способ оплаты:", {
        reply_markup: inlineKeyboard,
      });
    } else if (nextState === "entering_markup_percentage") {
      sendMessage(ctx, "Введите процент наценки (например, 10):");
    }
  }
};

const handlePaymentSelection = async (ctx, data) => {
  const chatId = ctx.chat.id;
  const paymentMethod = data.split('_').pop();
  userStates[chatId].paymentMethod = paymentMethod;
  userStates[chatId].state = "entering_fio";

  sendMessage(ctx, "Введите ваше ФИО:");
};

const handleShopSelection = async (ctx, data) => {
  const chatId = ctx.chat.id;
  const shop = data.split('_').pop();
  userStates[chatId].shop = shop;
  userStates[chatId].state = "entering_comment";

  sendMessage(ctx, "Введите комментарий к заказу:");
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

const handleFIO = (chatId, text, ctx) => {
  userStates[chatId].fio = text;
  userStates[chatId].state = "selecting_shop";

  const inlineKeyboard = new InlineKeyboard()
    .text("Магазин 1", "shop_Магазин 1")
    .text("Магазин 2", "shop_Магазин 2");

  sendMessage(ctx, "Выберите магазин:", {
    reply_markup: inlineKeyboard,
  });
};

const handleComment = (chatId, text, ctx) => {
  userStates[chatId].comment = text;
  sendOrderToGroup(chatId, userStates[chatId], ctx);
};

// Дополнительные функции
const toggleSubscription = (chatId, isSubscribing) => {
  isSubscribing ? subscribers.add(chatId) : subscribers.delete(chatId);
  bot.api.sendMessage(chatId, isSubscribing ? "Вы подписались на уведомления." : "Вы отписались от уведомлений.");
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
