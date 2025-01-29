import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export const dbPromise = open({
  filename: 'products.db',
  driver: sqlite3.Database,
});

export const fetchProducts = async () => {
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