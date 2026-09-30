# Contrato de dados — apuração eleitoral offline-first

Contrato v1 para armazenar, sincronizar e consultar dados de apuração do TSE. O cliente pode ler dados locais sem rede; a sincronização é incremental, idempotente e nunca substitui um snapshot mais novo por um mais antigo.

## Princípios

- `electionId`, `scope` e `snapshotId` identificam inequivocamente uma apuração.
- IDs e códigos oficiais são strings, inclusive códigos numéricos com zeros à esquerda.
- Percentuais e totais são calculados a partir de inteiros; não persistir `NaN` ou valores arredondados como fonte de verdade.
- Datas são ISO 8601 em UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`).
- Respostas/remessas podem ser repetidas. O consumidor deve aceitar reenvio sem duplicar dados.
- Dados recebidos do servidor são imutáveis. Correções chegam em um snapshot posterior ou em um evento com `revision` maior.
- `null` significa “não informado pelo TSE”; zero significa valor apurado igual a zero.

## Tipos base (TypeScript)

```ts
type ISODateTime = string; // ISO 8601 UTC
type UUID = string;
type ElectionId = string; // ex.: "2024-1-turno-municipal"
type SnapshotId = string;
type Revision = number; // inteiro >= 0, monotônico por escopo

type UF =
  | "AC" | "AL" | "AP" | "AM" | "BA" | "CE" | "DF" | "ES" | "GO"
  | "MA" | "MT" | "MS" | "MG" | "PA" | "PB" | "PR" | "PE" | "PI"
  | "RJ" | "RN" | "RS" | "RO" | "RR" | "SC" | "SP" | "SE" | "TO";

type Scope =
  | { kind: "national" }
  | { kind: "uf"; uf: UF }
  | { kind: "municipality"; uf: UF; municipalityId: string };

type SyncState =
  | "local-only"       // criado/alterado localmente, ainda não enviado
  | "queued"            // aguardando tentativa
  | "syncing"           // requisição em andamento
  | "synced"            // confirmado no servidor
  | "stale"             // existe snapshot local mais antigo que o disponível
  | "conflict"          // versões concorrentes; requer resolução
  | "failed"            // última tentativa falhou; pode ser reprocessado
  | "blocked";           // falha permanente ou contrato incompatível

type SyncMeta = {
  state: SyncState;
  localRevision: Revision;
  serverRevision: Revision | null;
  lastAttemptAt: ISODateTime | null;
  lastSuccessAt: ISODateTime | null;
  retryCount: number;
  nextRetryAt: ISODateTime | null;
  lastError?: { code: string; message: string; retryable: boolean };
};

type EntityEnvelope<T> = {
  schemaVersion: "1.0";
  entity: T;
  updatedAt: ISODateTime;
  revision: Revision;
  deletedAt: ISODateTime | null;
  sync: SyncMeta;
};
```

## Identidade territorial

```ts
type Municipality = {
  id: string;              // código oficial TSE/IBGE conforme fonte da carga
  ibgeCode: string | null;
  name: string;
  uf: UF;
  zoneCount?: number | null;
};

type TerritorialKey = {
  uf: UF;
  municipalityId?: string;
};
```

`municipalityId` deve permanecer estável durante a eleição. O nome exibido pode mudar em uma carga posterior, mas não é chave de relacionamento.

## Eleição, partidos e candidatos

```ts
type Election = {
  id: ElectionId;
  year: number;
  electionType: "municipal" | "general" | "plebiscite" | "other";
  round: 1 | 2 | null;
  title: string;
  officialStatus: "scheduled" | "in-progress" | "completed" | "cancelled";
  totalizationAt: ISODateTime | null;
  availableScopes: Scope[];
};

type Party = {
  id: string;             // identificador estável no dataset
  number: string;         // número eleitoral, quando aplicável
  acronym: string;
  name: string;
  federationId: string | null;
  federationName: string | null;
};

type Candidate = {
  id: string;
  electionId: ElectionId;
  name: string;
  ballotName: string;
  number: string;
  partyId: string | null;
  partyAcronym: string | null;
  coalitionName: string | null;
  office: "mayor" | "vice-mayor" | "councillor" | "governor" | "senator"
    | "federal-deputy" | "state-deputy" | "president" | "other";
  status: "registered" | "substituted" | "cancelled" | "deceased" | "unknown";
  isNullVoteOption: boolean;
  isBlankVoteOption: boolean;
};
```

Partidos e candidatos são cadastros separados dos resultados. Um resultado pode referenciar candidato/partido ausente durante uma carga parcial; o cliente deve preservar a referência e resolver a exibição quando o cadastro chegar.

## Resultados

Todos os campos `votes` são inteiros não negativos. `percent` é derivado e pode ser `null` quando `validVotes` é zero. Totais de município e UF usam o mesmo formato para permitir a mesma tela de leitura.

```ts
type VoteTotals = {
  validVotes: number;
  blankVotes: number;
  nullVotes: number;
  annulledVotes: number;
  totalVotes: number;
  abstentions: number | null;
  electorate: number | null;
};

type CandidateResult = {
  candidateId: string;
  partyId: string | null;
  votes: number;
  percent: number | null; // derivado de votes / validVotes * 100
  position: number | null;
  elected: boolean | null;
};

type MunicipalityResult = {
  electionId: ElectionId;
  municipality: Municipality;
  office: Candidate["office"];
  scope: { kind: "municipality"; uf: UF; municipalityId: string };
  totals: VoteTotals;
  candidates: CandidateResult[];
  pollingStations: {
    total: number | null;
    counted: number;
    percentCounted: number | null;
  };
  asOf: ISODateTime;
};

type UFResult = {
  electionId: ElectionId;
  uf: UF;
  office: Candidate["office"];
  scope: { kind: "uf"; uf: UF };
  totals: VoteTotals;
  candidates: CandidateResult[];
  municipalities: {
    total: number | null;
    counted: number;
    percentCounted: number | null;
  };
  asOf: ISODateTime;
};
```

Regras de consistência: `totalVotes >= validVotes + blankVotes + nullVotes + annulledVotes` (a diferença pode representar categorias específicas da fonte); `position` não deve ser usada como critério de desempate fora da ordenação oficial; listas de candidatos devem ser ordenadas por `position` quando disponível e depois por `candidateId`.

## Snapshot

Snapshot é uma visão completa e autoconsistente de um `electionId` em um `scope`. O cliente grava o envelope antes de trocar o ponteiro ativo, para que uma interrupção não deixe a leitura em estado misto.

```ts
type SnapshotManifest = {
  snapshotId: SnapshotId;
  schemaVersion: "1.0";
  electionId: ElectionId;
  scope: Scope;
  revision: Revision;
  generatedAt: ISODateTime;
  source: "TSE" | "local-import";
  isComplete: boolean;
  previousSnapshotId: SnapshotId | null;
  counts: {
    municipalities: number;
    parties: number;
    candidates: number;
    municipalityResults: number;
    ufResults: number;
  };
  checksum: string; // SHA-256 do payload canônico
};

type Snapshot = {
  manifest: SnapshotManifest;
  elections: EntityEnvelope<Election>[];
  municipalities: EntityEnvelope<Municipality>[];
  parties: EntityEnvelope<Party>[];
  candidates: EntityEnvelope<Candidate>[];
  municipalityResults: EntityEnvelope<MunicipalityResult>[];
  ufResults: EntityEnvelope<UFResult>[];
};
```

Snapshot parcial (`isComplete: false`) pode ser exibido, mas deve ser identificado como parcial. O ponteiro `activeSnapshotId` só pode apontar para um snapshot validado cujo `checksum`, `schemaVersion`, `electionId` e `scope` sejam compatíveis.

## Protocolo de sincronização

```ts
type SyncRequest = {
  requestId: UUID; // idempotência por tentativa lógica
  clientId: UUID;
  electionId: ElectionId;
  scope: Scope;
  haveSnapshotId: SnapshotId | null;
  haveRevision: Revision;
  want: "manifest" | "full-snapshot" | "changes";
  knownSchemaVersions: ["1.0"];
};

type SyncResponse =
  | { status: "not-modified"; snapshotId: SnapshotId; revision: Revision }
  | { status: "delta"; baseRevision: Revision; targetRevision: Revision; changes: Change[] }
  | { status: "snapshot"; snapshot: Snapshot }
  | { status: "rejected"; code: "SCHEMA_UNSUPPORTED" | "INVALID_SCOPE" | "INVALID_REVISION"; message: string };

type Change = {
  operation: "upsert" | "delete";
  entityType: "election" | "municipality" | "party" | "candidate"
    | "municipalityResult" | "ufResult";
  entityId: string;
  revision: Revision;
  payload: unknown | null;
  updatedAt: ISODateTime;
};
```

O cliente deve: (1) manter a fila local por `requestId`; (2) enviar a revisão conhecida; (3) aplicar delta somente se `baseRevision` for igual à revisão local; (4) solicitar snapshot completo em caso de lacuna, checksum inválido ou base divergente; (5) validar e persistir em transação; (6) atualizar `serverRevision` e `activeSnapshotId` somente após commit.

Backoff recomendado para `failed`: 1 s, 5 s, 30 s, 5 min, 30 min, com jitter. Erros `4xx` de contrato tornam o item `blocked`; indisponibilidade, timeout e `5xx` mantêm `queued`/`failed` e são reprocessáveis. A fila deve sobreviver a reinício do app.

## Exemplo JSON mínimo

```json
{
  "manifest": {
    "snapshotId": "snap-2024-1-turno-municipal-SP-00042",
    "schemaVersion": "1.0",
    "electionId": "2024-1-turno-municipal",
    "scope": { "kind": "municipality", "uf": "SP", "municipalityId": "3550308" },
    "revision": 42,
    "generatedAt": "2024-10-07T01:30:00.000Z",
    "source": "TSE",
    "isComplete": true,
    "previousSnapshotId": "snap-2024-1-turno-municipal-SP-00041",
    "counts": { "municipalities": 1, "parties": 2, "candidates": 2, "municipalityResults": 1, "ufResults": 0 },
    "checksum": "sha256:..."
  },
  "municipalityResults": [{
    "schemaVersion": "1.0",
    "entity": {
      "electionId": "2024-1-turno-municipal",
      "municipality": { "id": "3550308", "ibgeCode": "3550308", "name": "São Paulo", "uf": "SP" },
      "office": "mayor",
      "scope": { "kind": "municipality", "uf": "SP", "municipalityId": "3550308" },
      "totals": { "validVotes": 1000, "blankVotes": 20, "nullVotes": 30, "annulledVotes": 0, "totalVotes": 1050, "abstentions": null, "electorate": null },
      "candidates": [{ "candidateId": "cand-1", "partyId": "party-10", "votes": 600, "percent": 60, "position": 1, "elected": null }],
      "pollingStations": { "total": 10, "counted": 10, "percentCounted": 100 },
      "asOf": "2024-10-07T01:29:55.000Z"
    },
    "updatedAt": "2024-10-07T01:30:00.000Z",
    "revision": 42,
    "deletedAt": null,
    "sync": { "state": "synced", "localRevision": 42, "serverRevision": 42, "lastAttemptAt": "2024-10-07T01:30:02.000Z", "lastSuccessAt": "2024-10-07T01:30:02.000Z", "retryCount": 0, "nextRetryAt": null }
  }]
}
```

## Compatibilidade e migração

Mudanças incompatíveis incrementam `schemaVersion` e exigem um adaptador explícito. Campos novos devem ser opcionais ou aceitos como desconhecidos. O cliente deve conservar payload bruto e `checksum` até a validação terminar, permitindo reprocessamento sem nova descarga.
