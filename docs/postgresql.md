# PostgreSQL の強み（RDB・拡張・クラウド）

AWS や GCP を使うほど、RDB の既定値が PostgreSQL に寄って見える理由を、図と表で整理したメモです。投資判断ではなく機能の地図です。

ブラウザ向けの同じ内容は単体 HTML [`postgresql.html`](../postgresql.html)（CSS/JS 込み。`npm run postgresql` → http://localhost:1237/postgresql.html、またはファイルを直接開く）。

このリポジトリの家計簿・ニュース・レシートツールとは独立した静的解説で、データベースには接続しません。

## 1. 全体像

```mermaid
flowchart TB
  subgraph clients [利用側]
    App[アプリ / API]
    Batch[バッチ / ETL]
    BI[分析・BI]
    FDW[他DBを外部表に]
  end
  Pool[接続の入口: PgBouncer / RDS Proxy / Cloud SQL Auth Proxy]
  subgraph core [PostgreSQL コア]
    SQL[SQL / MVCC / WAL]
    ACL[制約・権限・RLS]
    Idx[B-Tree / GIN / GiST / BRIN]
    Ext[拡張 API]
  end
  Disk[普通のディスク]
  Shared[Aurora / AlloyDB の共有ストレージ]
  App --> Pool
  Batch --> Pool
  BI --> Pool
  FDW --> Pool
  Pool --> SQL
  SQL --- ACL
  SQL --- Idx
  SQL --- Ext
  core --> Disk
  core --> Shared
```

| 気づき | 意味 | 他エンジンとの差 |
| --- | --- | --- |
| マネージドの第一選択肢が PG | RDS、Aurora PostgreSQL、Cloud SQL、AlloyDB が同じ方言に寄る | Oracle はライセンス、MySQL はフォーク差が大きい |
| 拡張が製品機能になる | PostGIS / pgvector / pgaudit をチェックで有効化 | GIS・ベクトル・監査を別製品に分けなくて済むことが多い |
| 接続がプロキシ前提 | IAM + Auth Proxy / RDS Proxy | パスワードをアプリに焼かない運用が作りやすい |
| 論理レプリケーションが標準 | メジャーバージョン越えやクラウド間のオンライン移行 | ダンプだけに頼らず切り返し計画が立てやすい |

## 2. ベース RDB としての強さ

拡張の前に、素の PostgreSQL がすでに厳しい RDB です。MVCC（長い SELECT が書き込みを止めない）、トランザクション DDL、CHECK / EXCLUDE / 部分 UNIQUE、CTE・WINDOW・LATERAL、多様な索引が「JSON や GIS を足しても破綻しない」土台です。

| 領域 | 拡張なしでできること |
| --- | --- |
| SQL | CTE、再帰 CTE、WINDOW、LATERAL、DISTINCT ON、MERGE（15+）、生成列、IDENTITY |
| 型 | 数値・日時・UUID・配列・レンジ・ENUM・JSONB・tsvector |
| 索引 | B-Tree、Hash、GiST、SP-GiST、GIN、BRIN。部分索引・式索引・INCLUDE |
| その他 | LISTEN/NOTIFY、パーティション、パラレルクエリ |

| 観点 | PostgreSQL | MySQL / MariaDB | Oracle | SQL Server |
| --- | --- | --- | --- | --- |
| 標準 SQL | 強い | 普通 | 強い（ロックイン大） | 強い（T-SQL） |
| 型と索引 | JSONB + GIN が本家品質 | JSON はあるが限定的 | 強いがオプション課金になりやすい | JSON / 空間は後付け感 |
| 拡張 | `CREATE EXTENSION` | プラグイン文化が薄い | オプション製品の束 | CLR 等は別物 |
| クラウド間の持ち出し | 各社が互換エンジンを出す | フォーク差 | ライセンス | Azure に寄る |
| 書き込み水平分割 | 単一プライマリが基本 | 同様 | RAC 等は別スキル | Always On は可用性寄り |

Spanner / CockroachDB のグローバル書き込みは別種です。PostgreSQL 互換をうたっていても、制約・拡張・トランザクションの意味がずれます。

## 3. JSONB でありながら正規化して扱える

JSONB は schemaless に見えて、生成列・制約・外部キー・GIN で関係モデルに接続できます。よく使うキーだけ列に昇格し、残りは JSONB に残します。

```mermaid
flowchart LR
  payload[orders.payload JSONB]
  gin[GIN jsonb_path_ops]
  cid[customer_id uuid 生成列]
  st[status + CHECK]
  amt[amount + INDEX]
  customers[customers への FK]
  rest[items / utm はまだ列にしない]
  payload --> gin
  payload --> cid --> customers
  payload --> st
  payload --> amt
  payload --> rest
```

|  | json | jsonb | 関係列 |
| --- | --- | --- | --- |
| 保存 | 入力テキストに近い | 分解バイナリ | 型どおり |
| 索引 | 向かない | GIN、JSONPath、`@>` | B-Tree |
| 制約 | CHECK 程度 | 生成列経由が本命 | FK / UNIQUE / CHECK |
| 向くデータ | 原文が欲しい監査 | 変動キー、外部 API の余り | 結合・集計・金額・ステータス |

```sql
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload jsonb NOT NULL,
  customer_id uuid GENERATED ALWAYS AS ((payload->>'customer_id')::uuid) STORED,
  status text GENERATED ALWAYS AS (payload->>'status') STORED,
  amount integer GENERATED ALWAYS AS ((payload->>'amount')::integer) STORED,
  CONSTRAINT orders_status_chk CHECK (status IN ('draft', 'paid', 'void')),
  CONSTRAINT orders_amount_chk CHECK (amount >= 0),
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES customers (id)
);
CREATE INDEX orders_payload_gin ON orders USING gin (payload jsonb_path_ops);
CREATE INDEX orders_customer_idx ON orders (customer_id);
```

列にする条件の目安: 検索する、結合する、金額として集計する。

## 4. 拡張機能

| 拡張 | できること | RDS / Aurora PG | Cloud SQL / AlloyDB |
| --- | --- | --- | --- |
| PostGIS | 空間型と距離・包含 | 利用可 | 利用可 |
| pgvector | 近傍検索 | 比較的新しい版で可 | 利用可（AlloyDB は強化） |
| pgcrypto | ハッシュ、pgp、UUID | 利用可 | 利用可 |
| pg_trgm | `LIKE '%foo%'` を索引付きで | 利用可 | 利用可 |
| postgres_fdw | 別 PG を外部表に | 利用可 | 利用可 |
| pgaudit | 監査ログ | 利用可 | 利用可 |
| pg_stat_statements | 遅い SQL の集計 | 利用可 | 利用可 |
| ltree / hstore / citext | 木、古い K/V、大小無視 | 利用可 | 利用可 |
| TimescaleDB / Citus | 時系列、分散シャード | 原則なし | 原則なし |

マネージドでは許可リスト以外の拡張はほぼ不可。拡張の有無はクラウド間移行の最大のつまずきでもあります。製品の対応表はバージョンで変わるので、採用前に各社ドキュメントを確認してください。

## 5. スケール

左ほどマネージドが肩代わりし、右ほどエンジンの外の仕事です。プロセスモデルなので、スケールの前に接続プールが効きます。

1. 垂直（インスタンス変更）— 容易
2. 接続プール — 容易、ほぼ必須
3. Aurora / AlloyDB の容量と I/O — 容易
4. リードレプリカ — 普通（遅延と書き込み集中）
5. 宣言的パーティション — 普通
6. 書き込みシャーディング（Citus / 自前）— 難しい

| 手段 | 伸ばすもの | 容易性 | 落とし穴 |
| --- | --- | --- | --- |
| インスタンス大型化 | CPU / メモリ | 容易 | 上限、メンテ |
| 接続プール | 同時接続 | 容易 | 一時表や LISTEN との相性 |
| Aurora / AlloyDB ストレージ | 容量、フェイルオーバー | 容易 | 固有機能は持ち出しにくい |
| リードレプリカ | 参照 QPS | 普通 | 遅延 |
| パーティション | 巨大表のメンテ | 普通 | キー設計 |
| 論理レプリで分析へ | OLTP と OLAP の分離 | 普通 | DDL、シーケンス |
| シャーディング | 書き込み | 難しい | クロスシャード結合 |

## 6. 移行

PG→PG は `pg_dump` と論理レプリケーションがオープンなので道具が流用できます。MySQL / Oracle からは変換が本体です。

| 手段 | 停止時間 | 向くケース | 注意 |
| --- | --- | --- | --- |
| pg_dump / restore | サイズに比例 | 小さい DB、検証 | 権限・拡張・照合順序 |
| 物理バックアップ | 短いがメンテは必要 | 同一メジャー | マネージドでは使えないことが多い |
| 論理レプリケーション | 切り替えを短くできる | PG→PG、バージョン上げ | DDL、シーケンス、スロット |
| AWS DMS / GCP DMS | 設計次第 | 他エンジンから | 型マッピング |
| postgres_fdw | 表単位 | 段階移行 | 結合性能 |

容易になる条件: 先方に同じ拡張がある、照合順序を揃える、superuser 前提を捨てる、Aurora/AlloyDB 固有機能に依存しない。

## 7. 接続の安全性

```mermaid
flowchart LR
  Inet[インターネットの公開5432は使わない]
  Net[VPC / Private IP / PSC / PrivateLink]
  Conn[IAM + Auth Proxy / RDS Proxy]
  Wire[TLS + SCRAM]
  Authz[ROLE / GRANT / 列権限 / RLS]
  Inet -.-> Net --> Conn --> Wire --> Authz
```

| 層 | PostgreSQL 本体 | AWS | GCP |
| --- | --- | --- | --- |
| 認証 | SCRAM-SHA-256、クライアント証明書 | IAM DB 認証、Secrets Manager | IAM DB 認証、Secret Manager |
| 接続の出し方 | `sslmode=verify-full` | RDS Proxy | Cloud SQL / AlloyDB Auth Proxy |
| ネットワーク | `listen_addresses` | VPC、SG、PrivateLink | VPC、PSC、VPC SC |
| 認可 | GRANT、RLS | IAM は接続まで。表権限は SQL | 同様 |
| 監査・暗号 | pgaudit、pgcrypto | KMS、CloudTrail | CMEK、Cloud Audit Logs |

IAM でログインできても SELECT の範囲は GRANT と RLS です。プロキシ経由だとクライアント IP が全部プロキシに見えるので、`pg_hba` を IP 頼りにしない方がよいです。

## 8. AWS / GCP 対応

| やりたいこと | AWS | GCP | PostgreSQL 側 |
| --- | --- | --- | --- |
| 普通の OLTP | RDS for PostgreSQL | Cloud SQL for PostgreSQL | 素の PG に近い |
| フェイルオーバーと I/O | Aurora PostgreSQL | AlloyDB | SQL は PG、ストレージは独自 |
| 分析も少し寄せたい | レプリカ / 倉庫へ複製 | AlloyDB 列指向 | プロトコルは維持 |
| 地図 | PostGIS | PostGIS | 空間型と GiST |
| ベクトル | pgvector | pgvector / AlloyDB AI | 関係データと JOIN |
| 接続の秘密を減らす | IAM + RDS Proxy | IAM + Auth Proxy | ロールは DB 内 |
| グローバル読み取り | Aurora Global | クロスリージョンレプリカ | 書き込みリージョンは一つが基本 |

## 9. GCP の使い分け（Professional Database Engineer）

試験の定番は「PostgreSQL をフルに使うか」「書き込みをリージョン障害後も自動で続けるか」「コストか性能か」の三つ。**AlloyDB のマルチリージョンは Spanner のマルチリージョンではない**（secondary は読み取り専用・非同期）。問題文が「AlloyDB」だけのときは、特に断りがなければリージョナル HA（99.99%、メンテ込み）。MySQL / SQL Server なら AlloyDB は選べない。

```mermaid
flowchart TD
  pg{PG の拡張・方言をフルに使う?}
  pg -->|No: グローバル強整合・水平書き込み| SpannerMR[Spanner マルチリージョン]
  pg -->|Yes| region{リージョン喪失後も自動で書ける?}
  region -->|Yes| SpannerLimit[それでも Spanner<br/>PG方言は制限]
  region -->|No| fit{Cloud SQL の性能・SLA で足りる?}
  fit -->|コスト優先| CS[Cloud SQL Enterprise]
  fit -->|99.99% メンテ込み| Plus[Cloud SQL Enterprise Plus]
  fit -->|HTAP / ベクトル / 高性能| AlReg[AlloyDB リージョナル]
  fit -->|他リージョン読取と DR| AlMR[AlloyDB マルチリージョン]
```

| 選択肢 | 中身 | SLA（目安） | 書き込み | 試験で選ぶとき |
| --- | --- | --- | --- | --- |
| Cloud SQL for PostgreSQL（Enterprise） | 素の PG に近い。リフト＆シフトの既定 | HA 99.95%。メンテは除外 | 単一プライマリ。クロスリージョンは非同期読取 | コスト優先、標準 OLTP |
| Cloud SQL Enterprise Plus | データキャッシュ、read pool、ほぼ無停止メンテ、Advanced DR | HA 99.99%。メンテ込み | 単一プライマリ。書き込みエンドポイントを維持できる | ミッションクリティカルだが HTAP までは不要 |
| AlloyDB（製品名） | PG 互換 Google エンジン。ストレージ分離、列指向、AI | HA 99.99%。メンテ込み。フェイルオーバー目安 60 秒以内 | プライマリインスタンスだけが書く | 「AlloyDB」とだけあればだいたいこれ |
| リージョナル AlloyDB | 1 リージョン。プライマリ 2 ゾーン HA + read pool | ゾーン障害に耐える。リージョン喪失は耐えない | そのリージョンのみ | 重い PG、OLTP+分析、Cloud SQL では足りない |
| マルチリージョン AlloyDB | プライマリ + 最大 5 secondary。非同期 | 読取と DR。promote / failover / switchover が要る | secondary には書けない。planned switchover はゼロデータロス | 書き込みは本拠地1つ。他リージョンは読取と災害対策 |
| Spanner マルチリージョン | ネイティブ。PG 方言はあるが拡張はほぼ不可 | 99.999%（リージョナル Spanner は 99.99%） | クォーラム。リージョン喪失後も書き込みが生きる | 水平書き込み、グローバル強整合、台帳・在庫 |

| 問題文の手がかり | 選ぶ | 落とす選択肢 |
| --- | --- | --- |
| 最小変更・コスト最小・普通の HA | Cloud SQL Enterprise | AlloyDB / Spanner は過剰 |
| 99.99% メンテ込み、データキャッシュ、メンテ 1 秒未満 | Cloud SQL Enterprise Plus | Enterprise はメンテ除外。AlloyDB は HTAP が無いと過剰 |
| 同一 PG で OLTP+分析、列指向、ベクトル | リージョナル AlloyDB | Spanner は互換不足 |
| 東京書き込み、他リージョンは読取と DR、拡張は残す | マルチリージョン AlloyDB | Spanner は書き込みモデルが違う |
| 米欧同時更新、リージョン落ちても書き込み継続、99.999% | Spanner マルチリージョン | AlloyDB secondary は読取専用 |
| 既存が MySQL / SQL Server | Cloud SQL | AlloyDB は PG のみ |
| ペタバイトの倉庫 | BigQuery | AlloyDB 列指向は HTAP 補助 |

覚え方: Cloud SQL は普通の PostgreSQL、Plus は止まらない普通の PostgreSQL、AlloyDB は速い PostgreSQL、AlloyDB マルチリージョンは速い PostgreSQL の読取と DR、Spanner マルチリージョンはグローバル書き込み機に PG の顔を付けたもの。

SLA の適用条件（HA 有効、read pool 2 ノード以上など）を満たさない構成は数字どおりになりません。数値は改定されるので各 SLA ページを確認してください。

## 10. 向いていないこと

| やりたいこと | 現実 | 代わり |
| --- | --- | --- |
| 書き込みの水平分割 | 単一プライマリが基本 | シャード専用製品 |
| サーバレスでゼロ運用 | 接続と VACUUM は残る | 運用が消えるわけではない |
| 巨大入れ子 JSON を主データに | 行書き換えと GIN 肥大 | ホットキーは列へ |
| 任意の拡張 | 許可リスト以外は不可 | 必要拡張で基盤を決める |
| ペタバイトの倉庫 SQL | OLTP の仕事ではない | BigQuery / Redshift へ複製 |

強さの核は、RDB の約束（制約・トランザクション・SQL）を捨てずに、JSON・GIS・ベクトル・監査を同じバックアップ単位に足せることです。AWS と GCP はその核を壊さずに、接続・ディスク・フェイルオーバーだけを製品化しています。
