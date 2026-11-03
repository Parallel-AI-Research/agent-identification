import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PostgresStore } from "../collector/postgres-store.js";

const migration = (file: string) =>
  readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");

let database: PGlite;
const owner = randomUUID();
const product = randomUUID();
const operatorProduct = randomUUID();

before(async () => {
  database = new PGlite();
  for (const file of [
    "20261020093721_create_agent_identification_collector.sql",
    "20261101120000_add_customer_products.sql",
    "20261101130000_add_domain_claims.sql",
  ]) {
    await database.exec(await migration(file));
  }
  // Products as they stood before environments existed.
  await database.query(
    `insert into agent_identification.products
     (id, owner_id, name, site_id, secret_ciphertext, previous_secret_ciphertext,
      previous_secret_expires_at, created_at, updated_at)
     values ($1,$2,'Customer product','site_customer','sealed-current','sealed-previous',500,1,2),
            ($3,null,'ticket-management','ticket-management','sealed-operator',null,null,3,4)`,
    [product, owner, operatorProduct],
  );
  await database.query(
    `insert into agent_identification.product_origins (product_id, origin)
     values ($1,'https://a.example'),($1,'https://b.example'),($2,'https://fixture.example')`,
    [product, operatorProduct],
  );
  await database.exec(await migration("20261101140000_add_environments.sql"));
  // The current store reads the deletion marker, which a later migration adds.
  await database.exec(await migration("20261103120000_soft_delete_products.sql"));
});
after(async () => {
  await database?.close();
});

test("each existing product becomes production with its site ID and secrets intact", async () => {
  const store = new PostgresStore(
    async (sql, parameters) =>
      (await database.query<Record<string, unknown>>(sql, parameters)).rows,
  );
  const customer = await store.getEnvironmentBySiteId("site_customer");
  assert.equal(customer?.productId, product);
  assert.equal(customer?.type, "production");
  assert.equal(customer?.name, "Production");
  assert.equal(customer?.secretCiphertext, "sealed-current");
  assert.equal(customer?.previousSecretCiphertext, "sealed-previous");
  assert.equal(customer?.previousSecretExpiresAt, 500);
  assert.deepEqual(customer?.origins, ["https://a.example", "https://b.example"]);
  assert.deepEqual([customer?.createdAt, customer?.updatedAt], [1, 2]);

  const operator = await store.getEnvironmentBySiteId("ticket-management");
  assert.equal(operator?.productId, operatorProduct);
  assert.equal(operator?.secretCiphertext, "sealed-operator");
  assert.equal(await store.isRegisteredOrigin("https://fixture.example"), true);

  const listed = await store.listProducts(owner);
  assert.deepEqual(
    listed.map((item) => [item.name, item.environments.length]),
    [["Customer product", 1]],
  );
});

test("credentials no longer live on products, and the old origins table is gone", async () => {
  const { rows } = await database.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema='agent_identification' and table_name='products' order by 1`,
  );
  assert.deepEqual(
    rows.map((row) => row.column_name),
    // deleted_at comes from the later soft-delete migration, applied above for the store.
    ["created_at", "deleted_at", "id", "name", "owner_id", "updated_at"],
  );
  await assert.rejects(database.query("select 1 from agent_identification.product_origins"));
});

test("a product cannot have two environments of one type", async () => {
  await assert.rejects(
    database.query(
      `insert into agent_identification.environments
       (id, product_id, type, name, site_id, secret_ciphertext, created_at, updated_at)
       values ($1,$2,'production','Second','site_second','sealed',1,1)`,
      [randomUUID(), product],
    ),
  );
});
