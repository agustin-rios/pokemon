-- Datos de una corrida entre pasos. Sin PK, FK ni CHECK a propósito: la validación revisa
-- todo antes de cargar, y así puede informar cada problema en vez de fallar al insertar.
CREATE SCHEMA "staging";
CREATE TABLE "staging"."types" ("id" INTEGER, "name" TEXT);
CREATE TABLE "staging"."pokemon" (
  "id" INTEGER, "name" TEXT, "height" INTEGER, "weight" INTEGER,
  "base_experience" INTEGER, "sprite_url" TEXT);
CREATE TABLE "staging"."pokemon_types" ("pokemon_id" INTEGER, "type_id" INTEGER, "slot" SMALLINT);
CREATE TABLE "staging"."trainers" ("id" INTEGER, "name" TEXT, "region" TEXT, "created_at" DATE);
CREATE TABLE "staging"."captures" (
  "id" INTEGER, "trainer_id" INTEGER, "pokemon_id" INTEGER, "captured_at" TIMESTAMP(6),
  "level" INTEGER, "location" TEXT);
CREATE TABLE "staging"."battles" (
  "id" INTEGER, "pokemon_a_id" INTEGER, "pokemon_b_id" INTEGER, "winner_id" INTEGER,
  "fought_at" TIMESTAMP(6), "duration_seconds" INTEGER);
