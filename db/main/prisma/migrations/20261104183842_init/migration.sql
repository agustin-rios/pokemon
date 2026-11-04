-- CreateTable
CREATE TABLE "types" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pokemon" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "height" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "base_experience" INTEGER NOT NULL DEFAULT 0,
    "sprite_url" TEXT,

    CONSTRAINT "pokemon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pokemon_types" (
    "pokemon_id" INTEGER NOT NULL,
    "type_id" INTEGER NOT NULL,
    "slot" SMALLINT NOT NULL,

    CONSTRAINT "pokemon_types_pkey" PRIMARY KEY ("pokemon_id","type_id")
);

-- CreateTable
CREATE TABLE "trainers" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "created_at" DATE NOT NULL,

    CONSTRAINT "trainers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "captures" (
    "id" INTEGER NOT NULL,
    "trainer_id" INTEGER NOT NULL,
    "pokemon_id" INTEGER NOT NULL,
    "captured_at" TIMESTAMP(6) NOT NULL,
    "level" SMALLINT NOT NULL,
    "location" TEXT NOT NULL,

    CONSTRAINT "captures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battles" (
    "id" INTEGER NOT NULL,
    "pokemon_a_id" INTEGER NOT NULL,
    "pokemon_b_id" INTEGER NOT NULL,
    "winner_id" INTEGER NOT NULL,
    "fought_at" TIMESTAMP(6) NOT NULL,
    "duration_seconds" INTEGER NOT NULL,

    CONSTRAINT "battles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "types_name_key" ON "types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "pokemon_name_key" ON "pokemon"("name");

-- CreateIndex
CREATE INDEX "pokemon_types_type_id_idx" ON "pokemon_types"("type_id");

-- CreateIndex
CREATE UNIQUE INDEX "pokemon_types_pokemon_id_slot_key" ON "pokemon_types"("pokemon_id", "slot");

-- CreateIndex
CREATE INDEX "captures_trainer_id_idx" ON "captures"("trainer_id");

-- CreateIndex
CREATE INDEX "captures_pokemon_id_idx" ON "captures"("pokemon_id");

-- CreateIndex
CREATE INDEX "captures_captured_at_idx" ON "captures"("captured_at");

-- CreateIndex
CREATE INDEX "battles_pokemon_a_id_idx" ON "battles"("pokemon_a_id");

-- CreateIndex
CREATE INDEX "battles_pokemon_b_id_idx" ON "battles"("pokemon_b_id");

-- CreateIndex
CREATE INDEX "battles_winner_id_idx" ON "battles"("winner_id");

-- AddForeignKey
ALTER TABLE "pokemon_types" ADD CONSTRAINT "pokemon_types_pokemon_id_fkey" FOREIGN KEY ("pokemon_id") REFERENCES "pokemon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pokemon_types" ADD CONSTRAINT "pokemon_types_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captures" ADD CONSTRAINT "captures_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "trainers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captures" ADD CONSTRAINT "captures_pokemon_id_fkey" FOREIGN KEY ("pokemon_id") REFERENCES "pokemon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battles" ADD CONSTRAINT "battles_pokemon_a_id_fkey" FOREIGN KEY ("pokemon_a_id") REFERENCES "pokemon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battles" ADD CONSTRAINT "battles_pokemon_b_id_fkey" FOREIGN KEY ("pokemon_b_id") REFERENCES "pokemon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battles" ADD CONSTRAINT "battles_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "pokemon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
