'use client';
import { useState, useRef } from 'react';

interface ImportResult {
  ok?: boolean;
  error?: string;
  total_linhas?: number;
  importados?: number;
  ignorados?: number;
  erros_formato?: string[];
  erros_banco?: string[];
  mapeamento_colunas?: Record<string, number>;
}

export default function ImportarPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] || null);
    setResult(null);
  };

  const handleImport = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/import-abastecimentos', { method: 'POST', body: form });
      const json = await res.json();
      setResult(json);
    } catch {
      setResult({ error: 'Erro ao enviar arquivo' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#0f172a', color: '#f1f5f9',
      fontFamily: 'system-ui, sans-serif', padding: '2rem 1rem',
    }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <a href="/" style={{ color: '#60a5fa', textDecoration: 'none', fontSize: 14 }}>
            ← Voltar ao app
          </a>
          <h1 style={{ margin: '1rem 0 0.25rem', fontSize: '1.5rem', fontWeight: 700 }}>
            Importar Abastecimentos
          </h1>
          <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
            Importa o CSV do cartão frota diretamente — datas, vírgulas e R$ são convertidos automaticamente.
          </p>
        </div>

        {/* Upload */}
        <div style={{
          background: '#1e293b', borderRadius: 12, padding: '1.5rem',
          border: '2px dashed #334155', marginBottom: '1rem', textAlign: 'center',
        }}>
          <input ref={inputRef} type="file" accept=".csv,.tsv,.txt"
            onChange={handleFile} style={{ display: 'none' }} />
          <button onClick={() => inputRef.current?.click()} style={{
            background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
            padding: '0.6rem 1.2rem', cursor: 'pointer', fontSize: 14, marginBottom: '0.75rem',
          }}>
            Selecionar CSV
          </button>
          {file && (
            <p style={{ margin: '0.5rem 0 0', color: '#60a5fa', fontSize: 13 }}>
              {file.name} — {(file.size / 1024).toFixed(0)} KB
            </p>
          )}
          {!file && (
            <p style={{ margin: '0.5rem 0 0', color: '#64748b', fontSize: 13 }}>
              Formatos aceitos: CSV, TSV. Separador: vírgula ou ponto-e-vírgula.
            </p>
          )}
        </div>

        {/* Colunas esperadas */}
        <div style={{
          background: '#1e293b', borderRadius: 12, padding: '1.25rem',
          marginBottom: '1rem', fontSize: 13,
        }}>
          <p style={{ margin: '0 0 0.75rem', color: '#94a3b8', fontWeight: 600 }}>
            Colunas detectadas automaticamente (qualquer ordem):
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem' }}>
            {[
              ['DATA TRANSACAO', 'data da transação'],
              ['TIPO COMBUSTIVEL', 'gasolina, diesel...'],
              ['LITROS', 'volume abastecido'],
              ['VL/LITRO', 'preço por litro'],
              ['VALOR EMISSAO', 'valor total'],
              ['NOME ESTABELECIMENTO', 'nome do posto'],
              ['ENDERECO', 'endereço completo'],
              ['BAIRRO', 'bairro'],
              ['CIDADE', 'cidade'],
              ['UF', 'estado (sigla)'],
            ].map(([col, desc]) => (
              <div key={col} style={{ padding: '0.4rem 0.6rem', background: '#0f172a', borderRadius: 6 }}>
                <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>{col}</span>
                <span style={{ color: '#64748b' }}> — {desc}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: '0.75rem 0 0', color: '#64748b', fontSize: 12 }}>
            Datas em DD/MM/YYYY, valores com R$ e vírgulas são convertidos automaticamente.
          </p>
        </div>

        {/* Botão importar */}
        <button
          onClick={handleImport}
          disabled={!file || loading}
          style={{
            width: '100%', padding: '0.85rem', fontSize: 15, fontWeight: 600,
            background: !file || loading ? '#334155' : '#16a34a',
            color: !file || loading ? '#64748b' : '#fff',
            border: 'none', borderRadius: 10, cursor: !file || loading ? 'not-allowed' : 'pointer',
            marginBottom: '1.5rem',
          }}
        >
          {loading ? 'Importando...' : 'Importar dados'}
        </button>

        {/* Resultado */}
        {result && (
          <div style={{
            background: result.ok ? '#052e16' : '#450a0a',
            border: `1px solid ${result.ok ? '#166534' : '#991b1b'}`,
            borderRadius: 12, padding: '1.25rem',
          }}>
            {result.error && (
              <p style={{ color: '#fca5a5', margin: 0, fontWeight: 600 }}>
                Erro: {result.error}
              </p>
            )}
            {result.ok && (
              <>
                <p style={{ color: '#86efac', margin: '0 0 1rem', fontWeight: 700, fontSize: 16 }}>
                  Importacao concluida com sucesso!
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
                  {[
                    ['Total no CSV', result.total_linhas],
                    ['Importados', result.importados],
                    ['Ignorados', result.ignorados],
                  ].map(([label, val]) => (
                    <div key={String(label)} style={{ background: '#0f172a', borderRadius: 8, padding: '0.75rem', textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#4ade80' }}>{val}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>{label}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {result.erros_formato && result.erros_formato.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <p style={{ color: '#fbbf24', fontSize: 13, margin: '0 0 0.4rem', fontWeight: 600 }}>
                  Linhas com problema de formato ({result.erros_formato.length}):
                </p>
                {result.erros_formato.map((e, i) => (
                  <p key={i} style={{ color: '#fde68a', fontSize: 12, margin: '0.1rem 0', fontFamily: 'monospace' }}>
                    {e}
                  </p>
                ))}
              </div>
            )}

            {result.erros_banco && result.erros_banco.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <p style={{ color: '#f87171', fontSize: 13, margin: '0 0 0.4rem', fontWeight: 600 }}>
                  Erros do banco:
                </p>
                {result.erros_banco.map((e, i) => (
                  <p key={i} style={{ color: '#fca5a5', fontSize: 12, margin: '0.1rem 0', fontFamily: 'monospace' }}>
                    {e}
                  </p>
                ))}
              </div>
            )}

            {result.mapeamento_colunas && (
              <details style={{ marginTop: '0.75rem' }}>
                <summary style={{ color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
                  Mapeamento de colunas detectado
                </summary>
                <pre style={{ color: '#60a5fa', fontSize: 11, marginTop: '0.5rem', overflow: 'auto' }}>
                  {JSON.stringify(result.mapeamento_colunas, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
