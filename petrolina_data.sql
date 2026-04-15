-- DADOS PARA PETROLINA - PE
INSERT INTO stations (id, nome, bandeira, endereco, cidade, estado, latitude, longitude) VALUES
(gen_random_uuid(), 'Posto Autovia', 'Ipiranga', 'Avenida da Integração, 444, Vila Eduardo', 'Petrolina', 'PE', -9.3833, -40.5028),
(gen_random_uuid(), 'Posto Delta', 'Shell', 'Avenida Coronel Antônio Honorato Viana, 79, Gercino Coelho', 'Petrolina', 'PE', -9.3900, -40.4950),
(gen_random_uuid(), 'Posto Gené', 'Branco', 'Avenida Mário Rodrigues Coelho, 880, COHAB Massangano', 'Petrolina', 'PE', -9.4000, -40.5100),
(gen_random_uuid(), 'Posto Calumby', 'Petrobras', 'Avenida Sete de Setembro, 312, José e Maria', 'Petrolina', 'PE', -9.3750, -40.4850),
(gen_random_uuid(), 'Posto L3', 'Ale', 'Avenida João Pernambuco, 21', 'Petrolina', 'PE', -9.3950, -40.5050);

-- Preços para Petrolina (Baseados na pesquisa de mercado de R$ 7,59)
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco, data_atualizacao, reportado_por)
SELECT id, 'Gasolina Comum', 7.589, NOW(), 'IA Mercado' FROM stations WHERE cidade = 'Petrolina' AND nome = 'Posto Autovia';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco, data_atualizacao, reportado_por)
SELECT id, 'Etanol', 4.899, NOW(), 'IA Mercado' FROM stations WHERE cidade = 'Petrolina' AND nome = 'Posto Autovia';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco, data_atualizacao, reportado_por)
SELECT id, 'Gasolina Comum', 7.450, NOW(), 'IA Mercado' FROM stations WHERE cidade = 'Petrolina' AND nome = 'Posto Delta';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco, data_atualizacao, reportado_por)
SELECT id, 'Diesel S10', 6.999, NOW(), 'IA Mercado' FROM stations WHERE cidade = 'Petrolina' AND nome = 'Posto Delta';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco, data_atualizacao, reportado_por)
SELECT id, 'Gasolina Comum', 7.399, NOW(), 'IA Mercado' FROM stations WHERE cidade = 'Petrolina' AND nome = 'Posto Gené';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco, data_atualizacao, reportado_por)
SELECT id, 'Etanol', 4.750, NOW(), 'IA Mercado' FROM stations WHERE cidade = 'Petrolina' AND nome = 'Posto Gené';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco, data_atualizacao, reportado_por)
SELECT id, 'Gasolina Comum', 7.550, NOW(), 'IA Mercado' FROM stations WHERE cidade = 'Petrolina' AND nome = 'Posto Calumby';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco, data_atualizacao, reportado_por)
SELECT id, 'GNV', 5.200, NOW(), 'IA Mercado' FROM stations WHERE cidade = 'Petrolina' AND nome = 'Posto Calumby';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco, data_atualizacao, reportado_por)
SELECT id, 'Gasolina Comum', 7.299, NOW(), 'IA Mercado' FROM stations WHERE cidade = 'Petrolina' AND nome = 'Posto L3';

-- View refresh e índices já criados anteriormente.
