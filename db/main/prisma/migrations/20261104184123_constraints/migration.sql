-- Constraints que Prisma no modela (CHECKs y triggers). Prisma no los
-- introspecta ni los compara, así que `migrate dev` no los borra.

-- types
ALTER TABLE "types" ADD CONSTRAINT "types_name_check"
  CHECK (btrim("name") <> '');

-- pokemon
ALTER TABLE "pokemon" ADD CONSTRAINT "pokemon_name_check"
  CHECK (btrim("name") <> '');

ALTER TABLE "pokemon" ADD CONSTRAINT "pokemon_height_check"
  CHECK ("height" > 0);

ALTER TABLE "pokemon" ADD CONSTRAINT "pokemon_weight_check"
  CHECK ("weight" > 0);

ALTER TABLE "pokemon" ADD CONSTRAINT "pokemon_base_experience_check"
  CHECK ("base_experience" >= 0);

-- pokemon_types
ALTER TABLE "pokemon_types" ADD CONSTRAINT "pokemon_types_slot_check"
  CHECK ("slot" IN (1, 2));

-- Slot 2 exige que el mismo Pokémon tenga slot 1. Un CHECK no puede mirar
-- otras filas, así que va como constraint trigger. Diferido: se valida al
-- commit, de modo que el orden de inserción dentro de la transacción no importa.
CREATE FUNCTION "pokemon_types_slot_order"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  broken_id integer;
BEGIN
  SELECT t2."pokemon_id" INTO broken_id
  FROM "pokemon_types" t2
  WHERE t2."pokemon_id" IN (NEW."pokemon_id", OLD."pokemon_id")
    AND t2."slot" = 2
    AND NOT EXISTS (
      SELECT 1 FROM "pokemon_types" t1
      WHERE t1."pokemon_id" = t2."pokemon_id" AND t1."slot" = 1
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'pokemon_types: slot 2 sin slot 1 (pokemon_id %)', broken_id
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'pokemon_types_slot_order';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "pokemon_types_slot_order"
  AFTER INSERT OR UPDATE OR DELETE ON "pokemon_types"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "pokemon_types_slot_order"();

-- trainers
ALTER TABLE "trainers" ADD CONSTRAINT "trainers_name_check"
  CHECK (btrim("name") <> '');

ALTER TABLE "trainers" ADD CONSTRAINT "trainers_region_check"
  CHECK (btrim("region") <> '');

-- captures
ALTER TABLE "captures" ADD CONSTRAINT "captures_level_check"
  CHECK ("level" BETWEEN 1 AND 100);

ALTER TABLE "captures" ADD CONSTRAINT "captures_location_check"
  CHECK (btrim("location") <> '');

-- battles
ALTER TABLE "battles" ADD CONSTRAINT "battles_distinct_pokemon_check"
  CHECK ("pokemon_a_id" <> "pokemon_b_id");

ALTER TABLE "battles" ADD CONSTRAINT "battles_winner_check"
  CHECK ("winner_id" IN ("pokemon_a_id", "pokemon_b_id"));

ALTER TABLE "battles" ADD CONSTRAINT "battles_duration_seconds_check"
  CHECK ("duration_seconds" >= 0);
