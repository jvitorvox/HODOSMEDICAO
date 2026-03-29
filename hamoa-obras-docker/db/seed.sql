-- ══════════════════════════════════════════════════════════════
-- HAMOA OBRAS — Dados Iniciais (Seed)
-- ══════════════════════════════════════════════════════════════

-- ── Configurações padrão do sistema ──────────────────────────
INSERT INTO configuracoes (chave, valor) VALUES
('ldap', '{
  "servidor": "",
  "porta": "389",
  "portaSSL": "636",
  "baseDN": "",
  "dominio": "",
  "usuarioServico": "",
  "ssl": false,
  "starttls": true,
  "atributoLogin": "sAMAccountName",
  "atributoNome": "displayName",
  "atributoEmail": "mail",
  "atributoGrupos": "memberOf",
  "ativo": false
}'),
('assinatura', '{
  "provedor": "D4Sign",
  "apiKey": "",
  "apiSecret": "",
  "templateId": "",
  "webhookUrl": "",
  "signatarioFornecedor": true,
  "signatarioInterno": false,
  "signatarioInternoEmail": "",
  "instrucaoNF": "Obrigatório incluir o código {CODIGO_MEDICAO} no campo Observações/Dados Adicionais da NF.",
  "prazoAssinaturaDias": 7,
  "lembretesDias": [2, 1],
  "ativo": false
}'),
('notificacoes', '{
  "smtpHost": "",
  "smtpPorta": 587,
  "smtpUser": "",
  "tls": true,
  "remetente": "HAMOA OBRAS <noreply@empresa.com.br>",
  "notifNovaAprovacao": true,
  "notifAprovado": true,
  "notifReprovado": true,
  "notifAssinatura": true,
  "notifVencimento": true
}'),
('geral', '{
  "nomeEmpresa": "HAMOA Construções",
  "codigoMedicaoMascara": "MED-{AAMM}-{SEQ}",
  "periodoCorte": 5,
  "permitirMedicaoRetroativa": false,
  "exibirValorNaAprovacao": true,
  "diasAvisoVencimento": 3
}'),
('permissoes', '{
  "HAMOA-Diretores":     {"dashboard":true,"verMedicoes":true,"criarMedicao":true,"aprovarN1":true,"aprovarN2":true,"aprovarN3":true,"acompanhamento":true,"cadastros":true,"alcadas":true,"configuracoes":true},
  "HAMOA-GestoresObra":  {"dashboard":true,"verMedicoes":true,"criarMedicao":true,"aprovarN1":true,"aprovarN2":false,"aprovarN3":false,"acompanhamento":true,"cadastros":false,"alcadas":false,"configuracoes":false},
  "HAMOA-Planejamento":  {"dashboard":true,"verMedicoes":true,"criarMedicao":false,"aprovarN1":false,"aprovarN2":true,"aprovarN3":false,"acompanhamento":true,"cadastros":true,"alcadas":false,"configuracoes":false},
  "HAMOA-Financeiro":    {"dashboard":true,"verMedicoes":true,"criarMedicao":false,"aprovarN1":false,"aprovarN2":false,"aprovarN3":false,"acompanhamento":true,"cadastros":false,"alcadas":false,"configuracoes":false},
  "HAMOA-Visualizadores":{"dashboard":true,"verMedicoes":true,"criarMedicao":false,"aprovarN1":false,"aprovarN2":false,"aprovarN3":false,"acompanhamento":true,"cadastros":false,"alcadas":false,"configuracoes":false}
}')
ON CONFLICT (chave) DO NOTHING;

-- ── Usuário administrador padrão ──────────────────────────────
-- Senha padrão: hamoa@admin2025 (troque imediatamente!)
-- Hash gerado com bcrypt (cost 12)
INSERT INTO usuarios (login, nome, email, senha_hash, perfil, grupos_ad, ativo)
VALUES (
  'admin',
  'Administrador HAMOA',
  'admin@empresa.com.br',
  '$2b$12$WFiTPgX2o/xXNnFXja2k9eXVQA36e2x0ovASwRW6pGnxIO1wB261e',
  'ADM',
  ARRAY['HAMOA-Diretores'],
  TRUE
) ON CONFLICT (login) DO UPDATE SET senha_hash = EXCLUDED.senha_hash;

-- Usuários adicionais para teste
INSERT INTO usuarios (login, nome, email, senha_hash, perfil, grupos_ad, ativo)
VALUES
  ('gestor', 'Gestor de Obra', 'gestor@empresa.com.br', '$2b$12$/StuoyLnqd7zJHNKEy3DZelYQs0y50/1dyjUpc4hIlM8VZpp3aIA.', 'N1', ARRAY['HAMOA-GestoresObra'], TRUE),
  ('planejamento', 'Analista de Planejamento', 'planejamento@empresa.com.br', '$2b$12$/StuoyLnqd7zJHNKEy3DZelYQs0y50/1dyjUpc4hIlM8VZpp3aIA.', 'N2', ARRAY['HAMOA-Planejamento'], TRUE),
  ('diretor', 'Diretor de Obras', 'diretor@empresa.com.br', '$2b$12$/StuoyLnqd7zJHNKEy3DZelYQs0y50/1dyjUpc4hIlM8VZpp3aIA.', 'N3', ARRAY['HAMOA-Diretores'], TRUE)
ON CONFLICT (login) DO NOTHING;
