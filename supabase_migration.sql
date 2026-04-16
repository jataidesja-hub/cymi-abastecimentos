-- ========================================
-- MIGRAÇÃO: Adicionar ticket_log e osm_id
-- Execute este script no SQL Editor do Supabase
-- ========================================

-- 1. Novas colunas na tabela stations
ALTER TABLE stations ADD COLUMN IF NOT EXISTS ticket_log BOOLEAN DEFAULT false;
ALTER TABLE stations ADD COLUMN IF NOT EXISTS osm_id BIGINT;

-- 2. Índice único para evitar duplicatas de postos OSM
CREATE UNIQUE INDEX IF NOT EXISTS idx_stations_osm_id
  ON stations(osm_id)
  WHERE osm_id IS NOT NULL;

-- 3. Política de UPDATE (necessária para marcar ticket_log)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'stations' AND policyname = 'Atualização pública de postos'
  ) THEN
    CREATE POLICY "Atualização pública de postos"
      ON stations FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 4. Atualizar postos existentes de Petrolina com osm_id nulo (fica null, sem problema)
-- Os postos do OSM serão inseridos automaticamente quando reportados pelos usuários.

-- ✅ Pronto! Agora o app consegue salvar postos do OpenStreetMap com Ticket Log.
