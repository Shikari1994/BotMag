import 'dotenv/config';

export const TOKEN = process.env.TOKEN;
export const GROUP_ID = -1002301146731;
export const ITEMS_PER_PAGE = 10;
export const ITEMS_PER_PAGE_MARKUP = 8;
export const MAX_MESSAGE_LENGTH = 4096;

export const CATEGORIES = [
  "Часы", "Смартфоны", "Игровые приставки и геймпады",
  "Наушники", "Планшеты", "Ноутбуки", "Колонки",
  "Красота", "Аксессуары Apple", "Аксессуары Samsung"
];

export const CATEGORY_MAPPING = {
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