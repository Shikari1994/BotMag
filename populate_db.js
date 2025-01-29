import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fetch from 'node-fetch';

const API_URL = 'https://my-json-server.typicode.com/Shikari1994/products-api/products';

async function fetchProducts() {
  const response = await fetch(API_URL);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return await response.json();
}

async function populateDatabase() {
  const products = await fetchProducts();

  const db = await open({
    filename: 'products.db',
    driver: sqlite3.Database,
  });

  try {
    // Очистка таблицы перед заполнением (опционально)
    await db.run('DELETE FROM products');

    const stmt = await db.prepare('INSERT INTO products (category, name, price) VALUES (?, ?, ?)');
    for (const [category, items] of Object.entries(products)) {
      for (const item of items) {
        await stmt.run(category, item.name, item.price);
      }
    }
    await stmt.finalize();
    console.log('База данных успешно заполнена!');
  } catch (error) {
    console.error('Ошибка при заполнении базы данных:', error);
  } finally {
    await db.close();
  }
}

populateDatabase().catch(console.error);