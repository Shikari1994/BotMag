import { MAX_MESSAGE_LENGTH } from './config.js';

export const sendLongMessage = async (ctx, text, options = {}) => {
  for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
    const chunk = text.substring(i, i + MAX_MESSAGE_LENGTH);
    await ctx.reply(chunk, { ...options, parse_mode: "Markdown" });
  }
};

export const sendMessage = (ctx, text, options = {}) => ctx.reply(text, options);
export const sendMarkdown = (ctx, text) => sendLongMessage(ctx, text, { parse_mode: "Markdown" });

export const groupByBrand = (items) => {
  return items.reduce((acc, item) => {
    if (!acc[item.brand]) {
      acc[item.brand] = [];
    }
    acc[item.brand].push(item);
    return acc;
  }, {});
};

export const formatProductsMessage = (category, products) => {
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