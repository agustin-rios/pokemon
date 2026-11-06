
-- GET /items/summary: Pokémon y experiencia base promedio por tipo.
-- Un Pokémon con dos tipos cuenta en ambos.
CREATE OR REPLACE VIEW type_summary AS
SELECT t.id AS type_id,
       t.name AS type_name,
       count(*) AS pokemon_count,
       round(avg(p.base_experience), 2) AS avg_base_experience
FROM types t
JOIN pokemon_types pt ON pt.type_id = t.id
JOIN pokemon p ON p.id = pt.pokemon_id
GROUP BY t.id, t.name;

-- Consulta A: capturas por mes y % de cambio vs. el mes anterior (null en el primero).
-- month = primer día del mes. lag() compara con el mes anterior que tenga capturas.
CREATE OR REPLACE VIEW capture_monthly_growth AS
WITH monthly AS (
  SELECT date_trunc('month', captured_at)::date AS month,
         count(*) AS captures
  FROM captures
  GROUP BY 1
)
SELECT month,
       captures,
       round((captures - lag(captures) OVER w) * 100.0 / lag(captures) OVER w, 2) AS pct_change
FROM monthly
WINDOW w AS (ORDER BY month);

-- Consulta B: los 3 entrenadores con más capturas de cada región.
-- row_number: siempre 3 como máximo; los empates en capturas se ordenan por id.
CREATE OR REPLACE VIEW top_trainers_by_region AS
SELECT region, rank, trainer_id, trainer_name, captures
FROM (
  SELECT t.region,
         t.id AS trainer_id,
         t.name AS trainer_name,
         count(c.id) AS captures,
         row_number() OVER (PARTITION BY t.region ORDER BY count(c.id) DESC, t.id) AS rank
  FROM trainers t
  LEFT JOIN captures c ON c.trainer_id = t.id
  GROUP BY t.id
) ranked
WHERE rank <= 3;

-- Consulta C: por tipo, capturas con nivel ≥ 50 y su % sobre las capturas del tipo.
-- Una captura de un Pokémon con dos tipos cuenta en ambos.
CREATE OR REPLACE VIEW level_classification_by_type AS
SELECT t.id AS type_id,
       t.name AS type_name,
       count(*) AS total_captures,
       count(*) FILTER (WHERE c.level >= 50) AS high_level_captures,
       round(count(*) FILTER (WHERE c.level >= 50) * 100.0 / count(*), 2) AS high_level_pct
FROM captures c
JOIN pokemon_types pt ON pt.pokemon_id = c.pokemon_id
JOIN types t ON t.id = pt.type_id
GROUP BY t.id, t.name;
