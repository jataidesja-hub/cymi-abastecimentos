CREATE TABLE IF NOT EXISTS anp_city_prices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  municipio text NOT NULL,
  estado text NOT NULL,
  produto text NOT NULL,
  preco_medio numeric(6,3) NOT NULL,
  data_coleta text,
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS anp_city_prices_unique
  ON anp_city_prices (municipio, estado, produto);

CREATE INDEX IF NOT EXISTS anp_city_prices_municipio
  ON anp_city_prices (municipio, estado);
