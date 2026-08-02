# 意思決定ログ

このドキュメントは、実装を進める中で生じた設計判断を時系列で記録するものである。
`docs/architecture.md` が定めた大枠の方針（ADR）に対し、実装フェーズで生じた個別の技術選定・設計判断を追記していく。

`doc-updater` エージェントが `/pr`・`/after-pr`・`/update-docs` 実行時に、以下のいずれかに該当する変更があれば追記する。

- 新しいアーキテクチャパターンを導入した
- 既存の設計方針を変更した
- 技術選定（ライブラリ・フレームワーク）をした
- インフラ構成・永続化方式を変更した

## フォーマット

```
## YYYY-MM-DD: <決定内容の要約>

**背景**: なぜこの判断が必要になったか
**決定**: 何を決めたか
**影響**: 既存コード・今後の実装への影響
```

---

## 2026-07-31: マイグレーションのDDLはdocs/schema/*.sqlを`?raw`インポートで直接参照する

**背景**: `src/infrastructure/db/migrations.ts`（Issue #5、初回のマイグレーションランナー実装）でスキーマ定義をどう供給するか検討した際、TypeScript側にDDL文字列を転記・再定義する案もあった。しかし本リポジトリでは過去に`docs/schema/*.sql`とドメインドキュメント間でDDLが乖離した実績があり（コミット8761c58「Fix DDL drift from domain docs and FK reference gaps」）、さらに今回のIssue #5実装中にも、`docs/domain/accounts.md`に明記されたドメインルール（`is_system_managed`科目のライフサイクル制約）が当初の`docs/schema/accounts.sql`のDDLに反映されていないという類似の実装漏れがevaluatorのレビューで発覚した（詳細は`docs/guides/patterns.md`参照）。DDLの記述先が複数箇所に分散するとこの種の乖離が繰り返し起こりうることが具体的に確認された。
**決定**: `docs/schema/*.sql`をコピーせず、Viteの`?raw`インポート機能で`migrations.ts`から直接文字列として読み込む方式を採用した。`docs/schema/`配下のSQLファイルがDDLの唯一の情報源（single source of truth）となり、実装側とドキュメント側でDDLの内容が二重管理・乖離することが構造的に起こらなくなる。
**影響**: 今後スキーマを変更する際は`docs/schema/*.sql`を直接編集すればよく、`src/`側に別途DDLを転記・同期する作業は不要。一方でテーブル間の相互参照があるため、マイグレーション適用順序（`migrations.ts`の`MIGRATIONS`配列に並べる順）は各ファイルの依存関係を踏まえて手動管理する必要がある（`migrations.ts`のコメント参照）。

**検討したが採用しなかった判断**:
- 「システム管理科目（`is_system_managed`）の削除・非アクティブ化・name以外の変更を禁止する制約をDDLトリガーで強制する」（コミット5f809e4）は、実装フェーズでの技術選定というより、既存の`prevent_category_change`・`prevent_delete_account_with_references`トリガーと同じ確立済みパターンをもう一つの制約に横展開したものであり、新しい設計判断ではないため記録しない。「DDLトリガーで強制するか／Repository層でガードするか」の判断基準自体は`docs/domain/accounts.md` 3.3（循環参照防止の例）に既に記録されている。
- 「`docs/schema/`配下9ファイル全部を初回マイグレーションで一括適用する」は、実装時に生じた判断ではなくIssue #5本文で計画段階から確定していた前提であるため、実装フェーズの決定として記録しない。

## 2026-07-31: AccountRepositoryをドメイン層（型定義・インターフェース）とインフラ層（sql.js実装）に分離する

**背景**: `docs/architecture.md` 10章のテスト戦略は元々「ドメインロジックは純粋なTypeScript関数としてユニットテスト」「DBアクセス層（Repository実装）は統合テスト」という2層分離を意図していた。しかしIssue #5で実装した`AccountRepository`（`src/infrastructure/db/AccountRepository.ts`）はこれを踏襲せず、`Account`等の型定義・Repositoryインターフェースに相当する形状・sql.jsによるSQL実装が同一ファイル（インフラ層）に同居していた。次に着手する仕訳（JournalEntry）ドメインでは貸借バランス検証というDBアクセスを伴わない純粋なドメインロジックが発生する見込みであり、これをインフラ層のファイルに置くと10章のテスト戦略上ユニットテストとして分離できない。
**決定**: `src/domain/account/Account.ts`（型定義）・`src/domain/account/AccountRepository.ts`（Repositoryインターフェース、ポート）をドメイン層に新設し、`src/infrastructure/db/AccountRepository.ts`は`SqlJsAccountRepository.ts`にリネームした上で、クラス名を`SqlJsAccountRepository`に変更してドメイン層のインターフェースを`implements`する形に改めた（振る舞い・DDL制約への依存は変更なし）。詳細は`docs/architecture.md` 5.1節に反映した。
**影響**: 既存の`AccountRepository`利用箇所（テストコード含む）はインポート元とクラス名の変更が必要（`src/infrastructure/db/SqlJsAccountRepository.test.ts`で対応済み）。今後実装する仕訳（JournalEntry）等の他ドメインも、新規実装の時点から`src/domain/<集約名>/`（型定義・Repositoryインターフェース・純粋なドメインロジック）と`src/infrastructure/db/`（`SqlJs<集約名>Repository`実装）の分離構成に従う規約とする。

## 2026-07-31: createTestDatabaseでFK制約(PRAGMA foreign_keys = ON)を有効化する

**背景**: `docs/schema/journal.sql`の`journal_lines.journal_entry_id`は`ON DELETE CASCADE`を宣言しているが、SQLiteはデフォルトでFK制約（`REFERENCES`）自体を強制しない。Issue #5時点の`createTestDatabase`はこのPRAGMAを設定しておらず、CASCADE削除も、存在しない参照先を指すINSERTの拒否も機能していなかった。Issue #7で`JournalEntryRepository.delete`がCASCADEによる子`journal_lines`の削除に依存する挙動を持つため、この未設定が顕在化した。
**決定**: `createTestDatabase`内で`db.run('PRAGMA foreign_keys = ON')`を実行し、Node/Vitest上のテスト用DB接続でFK制約を有効化した。これによりCASCADE削除・存在しない参照先へのINSERT拒否がテスト環境で機能するようになった（回帰テスト: `src/infrastructure/db/createTestDatabase.test.ts`）。
**影響**: 本番のWeb Worker側DB接続（Issue #5スコープ外、`docs/architecture.md` 5章の起動シーケンスとして今後実装予定）でも、接続時に同様の`PRAGMA foreign_keys = ON`を設定する必要がある。この設定を怠ると、テストでは前提にしているCASCADE削除やFK制約違反の拒否が本番では機能しない状態になりうるため、Web Worker側のDB初期化を実装する際に必ず引き継ぐこと。

## 2026-07-31: 仕訳明細の更新は「全削除→再挿入」方式とし、journal_lines.idの安定性を保証しない

**背景**: `JournalEntryRepository.update`で明細行（`JournalLine`）をどう更新するか検討した。行ごとに追加・変更・削除を差分検出して個別にUPDATE/INSERT/DELETEを組み立てる方式も考えられたが、借方/貸方の入れ替えや行数増減を含む任意の変更を安全に表現しようとすると差分ロジックが複雑になり、書き込み直前に全体を検証する`assertJournalBalance`の設計（`docs/domain/journal.md` 1.3）とも相性が悪い。
**決定**: `SqlJsJournalEntryRepository.update`は既存の`journal_lines`を`journal_entry_id`条件で全削除し、入力された明細を新規行として再INSERTする方式を採用した。結果として`journal_lines.id`は更新のたびに新しい値へ再採番され、更新前のidは保持されない。この挙動は回帰テストで明示的に固定した（`src/infrastructure/db/SqlJsJournalEntryRepository.test.ts`）。
**影響**: 現時点で`journal_lines.id`を外部から参照する機能・テーブルは存在しないため実害はない。将来、明細行単位で外部参照（例: 添付ファイルの紐付け等）を持たせる機能を追加する場合は、この前提（update後にidが変わる）を踏まえて設計する必要がある。`docs/domain/journal.md` 2.1にも同内容を追記した。

## 2026-07-31: 明細数不足(2件未満)もUnbalancedJournalEntryErrorとして表現する

**背景**: `docs/domain/journal.md` 1.1は「1件の仕訳は2件以上の仕訳明細から成る」という不変条件を定めているが、Issue #7実装のAttempt 1では`assertJournalBalance`が借方合計・貸方合計の比較のみを行い、この最小明細数の検証が漏れていた（evaluatorのレビューで指摘、詳細は`docs/guides/patterns.md`参照）。専用のエラー型を新設するか、既存の`UnbalancedJournalEntryError`を流用するかを検討した。
**決定**: 新しいエラー型を追加せず、既存の`UnbalancedJournalEntryError`にオプションの`message`引数を追加して流用する方針にした。明細数不足の場合は「貸借不一致」ではなく明細数不足である旨を明示する専用メッセージを渡す。`debitTotal`/`creditTotal`プロパティは維持するため、既存の`instanceof`判定・呼び出し箇所への影響はない。
**影響**: 「仕訳として成立しない」ケース（貸借不一致・明細数不足のいずれも）は呼び出し側で単一の`instanceof UnbalancedJournalEntryError`判定で捕捉できる。原因の切り分けが必要な場合はメッセージ文字列（`at least 2 lines`を含むか）を見る必要があるため、将来UIでエラー内容ごとに異なる文言を出し分ける要件が出た場合は、専用のエラーサブクラス化やエラーコード付与を再検討する。

## 2026-07-31: Repositoryのcreateでオプショナル項目のデフォルト値をDDLのDEFAULT句に委ね、アプリケーション層で重複定義しない

**背景**: `docs/schema/projects.sql`の`kind`列は`DEFAULT 'event'`をDDL側で宣言している。既存の`SqlJsAccountRepository.create`はオプショナル項目（例: `isSystemManaged`）のデフォルト値を`input.isSystemManaged ?? false`のようにTypeScript側で解決してからINSERT文の全列に値を渡す方式だった。Issue #11の`SqlJsProjectRepository.create`で同じ方式（`input.kind ?? 'event'`）を踏襲すると、デフォルト値`'event'`がDDLとアプリケーションコードの両方に記述されることになり、将来どちらか一方だけを変更して乖離するリスクが生じる（同種のDDL/コード間の乖離は過去に実際に発生しており、`docs/decisions.md`の「マイグレーションのDDLはdocs/schema/*.sqlを`?raw`インポートで直接参照する」の背景でも触れられている）。
**決定**: `kind`が省略された場合はINSERT文自体に`kind`列を含めず、DDL側の`DEFAULT 'event'`に委ねる方式を採用した（`SqlJsProjectRepository.create`は`input.kind`の有無に応じて異なるSQL文を実行する）。
**影響**: 今後、DDL側にDEFAULT句を持つ列をRepositoryの`create`で扱う際は、アプリケーション層でデフォルト値を再定義せず、値が指定されない場合はINSERT文からその列を省略しDDLのDEFAULTに委ねる方式を優先する。既存の`SqlJsAccountRepository`（`isSystemManaged ?? false`等）は本方針の採用前の実装であり直ちに合わせて修正する必要はないが、今後改修する際はこの方針への統一を検討する。

## 2026-07-31: settlesリンクの作成は消込仕訳自体の作成と同一トランザクションにする(CreateJournalEntryInput.links)

**背景**: Issue #14で`journal_entry_links`(`link_type = 'settles'`)の作成を実装した際、当初は`JournalEntryRepository.create`で消込仕訳を作成した後、呼び出し元が続けて`createLink`を呼んでリンクを作成する2回の独立したRepository呼び出しとして実装した。この構成では、`createLink`側のsettlesハード検証(`SettlementTagMismatchError`、`docs/domain/settlement.md` 1.8)が失敗した場合でも、先に`create`でコミット済みの消込仕訳自体は残ってしまい、「検証失敗時は何も書き込まれない」という`docs/domain/journal.md` 1.3の設計原則(バランス検証と同じ「書き込み直前に検証し、失敗時は全て破棄する」パターン)が、2つのメソッド呼び出しに分割したことで実質的に崩れていた（evaluatorのレビューで指摘。詳細は`docs/guides/patterns.md`参照）。
**決定**: `CreateJournalEntryInput`に、作成する仕訳自身を`from_entry`とする関係(`JournalEntryLinkTarget`)の配列をオプション`links`として追加し、`JournalEntryRepository.create`内の単一DBトランザクション(BEGIN〜COMMIT)で仕訳ヘッダー・明細行・settlesリンクをまとめて書き込むように変更した。ハード検証に失敗した場合はROLLBACKし、仕訳・明細・リンクのいずれも残らない。既存の`createLink`メソッドは、作成済みの2つの仕訳間へ事後的にリンクを追加する場合(例: `allocates`の追加付与)専用として残し、そちらは独立したトランザクションのままとした。
**影響**: 消込仕訳を作成するアプリケーション層のコードは、仕訳作成とリンク作成を2回のRepository呼び出しに分けず、`create`呼び出し1回に`links`を含めて渡す必要がある。`docs/domain/journal.md` 1.8にも、settlesリンクが消込仕訳自体の作成と同一トランザクションで書き込まれる旨を反映した。今後、ある操作の完了に別レコードの書き込みが不可分に伴う(all-or-nothingを要求する)場合は、既存の独立したメソッドを呼び出し元で連結するのではなく、片方の入力としてもう片方の内容を受け取り単一メソッド内の単一トランザクションでまとめて書き込む設計を優先する。

## 2026-08-01: 正規化ハッシュはdjb2(自前実装・同期)を採用し、バッチ全体を入力にして同一バッチ内完全一致レコードを出現順インデックスで区別する

**背景**: 外部明細取込(`resolveExternalIds`)で`external_id`列を持たないCSVを扱う際、`entry_date`/`description`/`amount`から代替の`external_id`を生成する必要があった(`docs/domain/statement-import.md` 1.2・1.6)。Web Crypto(`SubtleCrypto.digest`)のような暗号学的ハッシュ関数も選択肢にあったが、重複判定ロジックを同期的な純粋関数としてユニットテストする方針(TDD)との相性が悪い(`SubtleCrypto`は非同期API)。また実装着手前のレビューで、同一CSV内に`entry_date`/`description`/`amount`が完全一致する複数レコードが存在するケース(例: 同じコンビニで同じ商品を同日中に2回購入)が発見され、レコード単体からハッシュ化すると同一の`external_id`が生成され`UNIQUE(account_id, external_id)`制約に違反することが判明した。
**決定**: 同期の非暗号学的ハッシュ関数**djb2**を自前実装で採用した(暗号強度は不要であり、ハッシュ衝突による誤検知はユーザーが明示的に選択して救済する設計を既に前提にしているため)。`resolveExternalIds`はレコード単体ではなくバッチ(CSV1回分の`ImportedRecord[]`)全体を入力に取り、`entry_date`/`description`/`amount`が完全一致するレコード群にはバッチ内での出現順インデックスをハッシュ入力に混ぜ込んで区別する設計にした。
**影響**: `resolveExternalIds`の呼び出し側は、レコードを1件ずつ処理するのではなく必ずバッチ単位で呼び出す必要がある(1件ずつ呼ぶと出現順インデックスによる区別が機能しない)。`docs/domain/statement-import.md` 1.6にも同内容を反映した。将来、他ドメインで同様の「値からの決定論的ID生成」が必要になった場合も、暗号学的ハッシュの非同期性がTDD方針と衝突しうることを踏まえ、非暗号学的ハッシュの採用を優先的に検討する。

## 2026-08-01: CSVの構文解析にpapaparseを採用する

**背景**: `docs/domain/statement-import.md` 1.3は「CSVの構文解析(クォート・エスケープ等)自体は標準的なライブラリに委ね、本ドメインの対象外とする」と方針のみを定めており、具体的なライブラリ名は指定していなかった(ドメインドキュメントは意図的に実装依存の詳細を持ち込まない、`docs/domain/statement-import.md` 3章の責務分担参照)。
**決定**: `readCsv`(CSV読み取り、`src/domain/statement-import/readCsv.ts`)の実装にnpmパッケージ`papaparse`(`@types/papaparse`)を採用した。区切り文字・改行コード・クォートの吸収をpapaparseに委ね、文字コードの吸収(UTF-8/Shift-JIS等)は`TextDecoder`で別途行う2段階構成にした。
**影響**: `package.json`に`papaparse`/`@types/papaparse`が依存として追加された。ドメインドキュメント(`docs/domain/statement-import.md`)側は「標準的なライブラリに委ねる」という抽象度を保ったままとし、具体的なライブラリ名はこの決定ログ側にのみ記録する(`docs/architecture.md`の技術スタック一覧がsql.js等アプリ全体のインフラ選定を担うのに対し、こちらは1ドメインの実装詳細であるため`docs/decisions.md`に留める)。

## 2026-08-01: CreateJournalEntryInputにexternalTransactionRefを追加し、突合マスタの書き込みを仕訳作成と同一トランザクションにする

**背景**: 外部明細取込のレビュー確定では、`journal_entries`/`journal_lines`と`external_transaction_refs`(突合マスタ、`docs/domain/reconciliation.md` 2章)を同一トランザクションで書き込む必要がある(`docs/domain/statement-import.md` 1.5手順7)。既存の`CreateJournalEntryInput.links`(消込仕訳作成時に`journal_entry_links`を同一トランザクションで書き込むための拡張、本ファイル2026-07-31「settlesリンクの作成は消込仕訳自体の作成と同一トランザクションにする」参照)と同種の要件だった。
**決定**: `links`と同じ設計を踏襲し、`CreateJournalEntryInput`に任意項目`externalTransactionRef`を追加した。`SqlJsJournalEntryRepository.create`の既存のBEGIN〜COMMITトランザクション内で、`ExternalTransactionRefRepository.create()`を呼び出す形にした。`ExternalTransactionRefRepository.create()`自体は単一INSERTのみでBEGIN/COMMITを持たない設計にしたため、呼び出し元の既存トランザクションへ安全に合流できる(独自にトランザクション境界を持つメソッドを内側から呼ぶとネストしたBEGINでエラーになるため)。
**影響**: 今後、ある仕訳の作成に不可分に伴う別レコードの書き込み(`links`・`externalTransactionRef`に続く3例目以降)を追加する場合も、`CreateJournalEntryInput`への任意項目追加+既存トランザクションへの合流という同じパターンに従う。合流させるRepositoryメソッド側は、独自にBEGIN/COMMITを持たない(単一の書き込みで完結する)設計にする必要がある点に注意する。

## 2026-07-31: エラー型の使い分け基準(同一不変条件のバリエーションは流用、独立した業務ルールは新設)

**背景**: 2026-07-31の「明細数不足もUnbalancedJournalEntryErrorとして表現する」決定では、既存のエラー型に近い制約(貸借不一致と明細数不足)を専用エラー型を新設せず流用する方針を採った。一方Issue #14では、`is_reconcilable`資産・負債への直接記帳制限違反用に`RestrictedAccountPostingError`を、settlesリンク作成時のタグ不整合違反用に`SettlementTagMismatchError`をそれぞれ新規のエラー型として新設した。両者は一見矛盾するように見えるため、判断基準を明確化しておく必要があった。
**決定**: 検証対象が「同じ不変条件のバリエーション」（例: 貸借バランス一致と明細数不足は、どちらも「仕訳として成立するか」という単一の不変条件の一部）である場合は既存のエラー型を再利用し、メッセージで原因を書き分ける。一方、検証対象が概念的に独立した別の業務ルール（貸借バランスの整合性とは無関係な、`is_reconcilable`資産への記帳経路制限や、settlesリンクのタグ整合性）である場合は、呼び出し側が`instanceof`で明確に区別できるよう専用のエラー型を新設する。
**影響**: 今後仕訳ドメインおよび他ドメインに新しい検証を追加する際は、この基準（同一不変条件のバリエーションか、独立した業務ルールか）に沿ってエラー型を再利用するか新設するかを判断する。既存の3種（`UnbalancedJournalEntryError`・`RestrictedAccountPostingError`・`SettlementTagMismatchError`）の使い分けを具体例として参照できる。

## 2026-08-01: 消込ドメインの純粋関数は他集約のメタデータをDB参照せず、呼び出し側が解決したaccountIdを明示的な引数として受け取る

**背景**: Issue #21で`docs/domain/settlement.md` 1.6〜1.8を実装する（`calculateSettlementBalance`・`findUnsettledEntries`・`copySettlementTag`・`detectSettlementTagMismatch`）際、消込対象の一時勘定をどう関数に渡すか検討した。`accounts.is_reconcilable`のような他集約（Account）のメタデータを関数内で参照する設計も考えられたが、`docs/architecture.md` 5.1が定めるドメイン層（`src/domain/<集約名>/`）はsql.js等のインフラ依存を一切持たない純粋なTypeScriptのみで構成する方針であり、そもそもDBアクセスを伴う参照はできない。
**決定**: 上記4関数はいずれも、対象の一時勘定を`accounts`テーブルから解決せず、呼び出し側が特定済みの一時勘定`accountId`（`settlementAccountId`）を明示的な引数として受け取る設計にした。`is_reconcilable`の判定自体は呼び出し側（アプリケーション層・Repository層）の責務のままとし、純粋関数側はその結果（対象科目のID）を前提として受け取るだけに留める。
**影響**: 今後、他集約のメタデータに依存しているように見える純粋なドメインロジックを追加する場合も、関数内でDB参照したり他集約のエンティティ全体を引数に取ったりするのではなく、判定に必要な最小限の値（ID等）を呼び出し側が解決した上で明示的な引数として渡す設計を優先する。この方針は`docs/architecture.md` 5.1の「ドメイン層は純粋なTypeScriptのみで構成する」から導かれる帰結でもある。

## 2026-08-01: journal_entry_linksの汎用トラバーサル(findLinkedEntries)を再利用するか、リンクの有無だけを直接判定するかは「候補一覧(entries)にfrom_entry側の実体が含まれる保証があるか」で判断する

**背景**: Issue #22で`findUnallocatedEntries`(割勘対象候補の絞り込み、`docs/domain/expense-splitting.md` 1.5節)を実装する際、当初は同じIssueで新設した`findLinkedEntries`(`journal_entry_links`のlink_type非依存の汎用トラバーサル、`docs/domain/journal.md` 1.8)を再利用する実装にした。しかし`findLinkedEntries`は`to_entry`に一致するリンクの`from_entry`側の仕訳を、呼び出し側が渡す`entries`引数から実体解決する設計であるため、割勘対象候補の絞り込みのように「候補一覧(`entries`)にはまだ割り勘されていない元仕訳しか含まれず、対応する割勘仕訳(from_entry側)がロードされているとは限らない」場面では、リンクが存在しても対応する実体が`entries`に無いため誤って「リンクなし」と判定してしまうことが実装中に判明した。
**決定**: `findUnallocatedEntries`は`findLinkedEntries`を使わず、`linksByEntryId`から対象仕訳がallocatesリンクの`to_entry`側として登場するかどうかを直接判定する実装にした(`calculateSettlementBalance`・`findUnsettledEntries`と同じ絞り込みパターン)。判断基準は「実体(関連する仕訳オブジェクト)そのものが必要か、リンクの存在確認だけで足りるか」とし、前者は`findLinkedEntries`(entries解決を伴う)、後者は`linksByEntryId`の直接走査(存在確認のみ)を使い分ける。
**影響**: 今後journalドメインの汎用プリミティブ(`findLinkedEntries`等)を他ドメインに再利用する際は、呼び出し側が渡す候補一覧に対象仕訳の実体が確実に含まれるかを確認する必要がある。含まれる保証がない場面(例: UI側の候補一覧が「まだ処理されていない仕訳」のみを持つ場合)では、実体解決を要求する汎用トラバーサルではなく、`linksByEntryId`を直接判定する専用関数を新設する方を優先する。

## 2026-08-01: 財務諸表の集計はsql.jsのSQL集約クエリではなく「Repositoryが読み出した仕訳・科目一覧 + 純粋関数」方式で実装し、区分をまたぐ合算は軸非依存の集計エンジン(sumBalanceAcrossCategories)に共通化する

**背景**: Issue #23で`docs/domain/financial-statements.md` 2.1節の残高計算・PL/BS生成、および`docs/domain/counterparties.md` 1.7節・`docs/domain/household-members.md` 1.4節の取引先別/世帯メンバー別集計を実装するにあたり、`SUM`/`GROUP BY`等のSQL集約クエリをsql.js側に実装する案もあった。しかし`docs/architecture.md` 10章のテスト戦略は「集計ロジックは純粋なTypeScript関数としてユニットテストする」ことを前提としており、SQL集約クエリとして実装すると集計ロジックの検証がRepository層の統合テスト(sql.js経由)に混在してしまう。また取引先別・世帯メンバー別集計は、資産・負債・純資産・収益・費用という区分をまたいで残高計算の一般式(区分ごとに増加側が異なる)を適用してから合算する必要があり、この「区分をまたぐ合算」ロジック自体が取引先軸・世帯メンバー軸のどちらでも同一だった。
**決定**: `calculateAccountBalance`(区分ごとの残高計算の一般式)・`sumBalanceAcrossCategories`(区分をまたぐ合算、絞り込み後の明細群を受け取るだけの軸非依存な集計エンジン)・`summarizeAccountsByCategory`(区分別の科目内訳集計、PL/BS共通)を`src/domain/financial-statement/`に純粋関数として実装した。`aggregateByCounterparty`・`aggregateByHouseholdMember`はそれぞれ`counterparty_id`一致・実効メンバー一致で明細を絞り込んだ上で`sumBalanceAcrossCategories`に委譲するだけの薄いラッパーとした。仕訳・科目の読み出し(Repositoryからの取得)と集計ロジック(純粋関数)を明確に分離し、`entries`/`accounts`は呼び出し側(アプリケーション層)がRepositoryから取得して引数で渡す設計にした。
**影響**: Issue #12(プロジェクト別集計)は本Issueとは統合せず、後続で`aggregateByProject`を同じパターン(`project_id`一致で絞り込み→`sumBalanceAcrossCategories`に委譲)で実装する想定とした。`sumBalanceAcrossCategories`・`calculateAccountBalance`は軸(取引先・世帯メンバー・プロジェクトのいずれか)に一切依存しないため、Issue #12側で新規の集計エンジンを作る必要はなく、絞り込み条件だけを実装すればよい。将来、SQL側での集計(パフォーマンス最適化等)が必要になった場合は、`docs/architecture.md` 4.1の`sql.js`再評価トリガーと合わせて見直す。

## 2026-08-01: タグ不整合の事後検知(detectSettlementTagMismatch)は既存の作成時ハード検証とロジックが類似していても実装を共通化せず、独立した関数として実装する

**背景**: Issue #21で実装した`detectSettlementTagMismatch`（`docs/domain/settlement.md` 1.8の事後検知）は、「to_entry側の一時勘定行と一致する行（`account_id`・`project_id`・`household_member_id`が一致し`amount`が条件を満たす）が消込仕訳側に存在するか」という判定ロジックが、既存の`SqlJsJournalEntryRepository.assertSettlementTagMatch`（Issue #14/A0で実装済みの作成時ハード検証）とほぼ同一だった。計画Issue #21の本文には当初「作成時のハード検証」自体を実装する項目も含まれていたが、実装着手前にA0で既に実装済みと判明したため、本Issueのスコープを事後検知のみに縮小した経緯がある。
**決定**: 判定ロジックが類似していることを理由に、既に確定済み・レビュー済みの`assertSettlementTagMatch`をリファクタして共通の純粋関数に切り出すことはせず、`detectSettlementTagMismatch`を独立した新規関数として実装した。結果としてロジックの重複を許容する。
**影響**: 将来どちらか一方の判定ロジック（例: N:N時の行対応の扱い）を変更する場合、もう一方への反映漏れがないか手動で確認する必要がある（自動では同期されない）。今後、別Issueで既に実装・レビュー済みの確定済みコードと類似したロジックを新しいIssueで実装する場合も、類似性だけを理由に確定済み実装を横断的にリファクタしてスコープを広げるのではなく、そのIssueのスコープ（影響範囲）に実装を限定することを優先する。共通化するかどうかは、あくまで別途の判断（別Issue）として扱う。

## 2026-08-01: project_id単位の一括物理削除(deleteByProjectId)は既存delete(id)のループ呼び出しではなく、専用メソッド+単一トランザクションのDELETE...WHERE IN(SELECT)で実装する

**背景**: Issue #52で、誤って投入した割勘バッチ(`project_id`、`docs/domain/expense-splitting.md` 1.2)をまとめて取り消す機能を検討した。アプリケーション層で既存の`JournalEntryRepository.delete(id)`を対象仕訳の件数分ループ呼び出しする実装も選択肢にあったが、この方式は原子性がなく、途中の1件でエラーが起きると一部だけ削除された中途半端な状態が残りうる。
**決定**: `JournalEntryRepository`(ポート)に`deleteByProjectId(projectId)`を新設し、`SqlJsJournalEntryRepository`側で`DELETE FROM journal_entries WHERE id IN (SELECT DISTINCT journal_entry_id FROM journal_lines WHERE project_id = ?)`を単一のDBトランザクション(BEGIN〜COMMIT)内で実行するall-or-nothing方式で実装した。対象の特定(どの`journal_entries`を消すか)と削除実行をインフラ層(Repository実装)側で完結させ、`journal_lines`・`journal_entry_links`への波及は既存の`ON DELETE CASCADE`にすべて委ねる(アプリケーション層で子レコードを個別削除するロジックは追加しない)。削除対象に精算済み(`settles`リンクを持つ)仕訳が混在していても、`docs/domain/journal.md` 1.5「物理削除は常に許可する」方針をそのまま踏襲してガードしない(この方針を明示的に固定する回帰テストを追加した)。
**影響**: 2026-07-31「settlesリンクの作成は消込仕訳自体の作成と同一トランザクションにする」で採用した「不可分な複数レコード操作は単一トランザクションでまとめる」というパターンを、書き込みではなく削除の一括操作にも適用した前例になる。今後、ある集約に紐づく複数レコードをまとめて取り消す機能(例: 他の軸単位での一括削除)が必要になった場合も、アプリケーション層での単発メソッドのループ呼び出しではなく、Repositoryに専用の一括操作メソッドを新設し単一トランザクション内で完結させる設計を優先する。`docs/domain/journal.md` 1.5・`docs/domain/expense-splitting.md` 1.5にも同内容を反映した。

## 2026-08-01: クロスドメインのimportは「型のみ」に限定せず、DB非依存の純粋関数(ロジック)にも許容する(project→financial-statement)

**背景**: Issue #12で非アクティブ化提案の判定ロジック(`isSettlementBalanceZero`、`docs/domain/projects.md` 1.3節・1.5節)を実装するにあたり、`kind='settlement'`のプロジェクトに紐づく資産・負債科目の残高計算を`financial-statement`ドメインの`summarizeAccountsByCategory`に委ねる必要があった。既存の`settlement`ドメイン(`calculateSettlementBalance`・`findUnsettledEntries`等)は`journal`ドメインの`JournalEntry`・`JournalEntryLink`を`import type`する前例を持つが、いずれも型定義のみのimportであり、他ドメインの実装済み関数(ロジック本体)をそのままimportして呼び出すクロスドメイン利用は今回が初めてだった。
**決定**: 呼び出し先が「DB非依存の純粋関数」であり、かつ呼び出し元・呼び出し先の双方がドメイン層(`src/domain/<集約名>/`、`docs/architecture.md` 5.1)に閉じていることを条件に、集約をまたいだ関数(ロジック)のimport・再利用を許容する方針とした。`isSettlementBalanceZero`(`src/domain/project/`)は`summarizeAccountsByCategory`(`src/domain/financial-statement/`)をそのままimportして呼び出す構成にした(Issue #12計画時点でユーザーと合意済み)。
**影響**: 今後、ある集約の判定・集計ロジックが別集約の既存の純粋関数と本質的に同じ計算を必要とする場合、両者がドメイン層の純粋関数である限りロジックを複製せずクロスドメインimportで再利用することを優先する。ただし呼び出し先がインフラ層(Repository実装等)を挟む場合や非純粋関数(DBアクセスを伴う)の場合はこの前例を適用できない。

## 2026-08-01: RPCプロトコルにComlinkを採用し、ドメインエラーは既定の"throw" transferHandlerを差し替えてinstanceofを保持する

**背景**: `docs/architecture.md` 5章は「Reactのメインスレッドはメッセージパッシング（RPC）経由でのみDBにアクセスする」という方針のみを定めており、具体的なRPCプロトコルの実装方式は未確定だった（Issue #24計画時点）。素の`postMessage`を手続き的に扱う自前実装も選択肢にあったが、10種類のRepositoryインターフェースをメインスレッド側から型安全に呼び出せる形で公開する必要があり、リクエストIDの管理・Promiseの解決/棄却・型定義の同期を自前で実装するとボイラープレートが増える。加えて、Repositoryのメソッドは`UnbalancedJournalEntryError`等6種類のドメインエラー（本ファイル2026-07-31「エラー型の使い分け基準」参照）を投げるため、Worker境界を越えてもこれらが`instanceof`判定できる形で呼び出し元に伝わる必要がある。
**決定**: RPCプロトコルにnpmパッケージ`comlink`を採用した。Worker側は全Repositoryインスタンスを集約した1つのレジストリオブジェクトを`Comlink.expose()`し、メインスレッド側は`Comlink.wrap<RepositoryRegistry>()`で型安全なプロキシとして呼び出す。Comlinkの既定の`"throw"` transferHandler（`error.message`/`name`/`stack`のみ転送し、カスタムErrorサブクラスの`instanceof`・追加プロパティ`debitTotal`等を失う）は、ドメインエラー6種についてのみ`name`/`message`/追加プロパティを分解・復元する実装に差し替えた（`registerDomainErrorTransferHandler`）。既定ハンドラの`canHandle`（内部シンボル`throwMarker`判定に依存し外部から再現不可）はそのまま再利用し、`serialize`/`deserialize`のみをドメインエラー用に分岐させることで、ドメインエラー以外（通常のError・任意の値のthrow）は既定の挙動を壊さず維持している。
**影響**: `package.json`に`comlink`が依存として追加された（`docs/architecture.md` 3章の技術スタック一覧に反映済み）。新しいドメインエラー型を追加する場合は`src/infrastructure/rpc/domainErrorRegistry.ts`の`DOMAIN_ERROR_REVIVERS`に1エントリ追加する必要がある（追加を忘れると、Worker側でそのエラーがスローされた際にメインスレッド側で「未知のドメインエラー」として復元に失敗する）。Worker側・メインスレッド側の双方で、`Comlink.expose`/`Comlink.wrap`を呼ぶ前に`registerDomainErrorTransferHandler()`を1度呼び出す必要がある。

## 2026-08-01: RPC越しに渡せないRepositoryインスタンス引数は、レジストリ内部で結線した縮小シグネチャのラッパーAPIとして公開する

**背景**: `JournalEntryDraftRepository.confirm(id, journalEntryRepository)`は、下書き仕訳の確定に伴い作成する本仕訳を書き込むための`JournalEntryRepository`インスタンス自体を第2引数に取るドメイン層のインターフェース設計だった。しかしComlink（および素のpostMessageの構造化複製アルゴリズム）は関数を含むオブジェクト（Repositoryインスタンスのようなメソッドを持つオブジェクト）をそのまま複製できないため、このメソッドをそのまま`Comlink.expose()`しても、メインスレッド側から対応する`journalEntryRepository`引数を渡す手段がない。
**決定**: `createRepositoryRegistry`がexposeする`RepositoryRegistry`型では、`journalEntryDraft`キーの型を素の`JournalEntryDraftRepository`ではなく、`confirm`のシグネチャを`confirm(id: number): JournalEntry`（`journalEntryRepository`引数を除去）に縮小した`JournalEntryDraftRpcApi`とした。レジストリ生成時にWorker内で既に生成済みの`journalEntryRepository`インスタンスをクロージャで捕捉し、`confirm: (id) => journalEntryDraftRepository.confirm(id, journalEntryRepository)`という薄いラッパーとして結線する。ドメイン層の`JournalEntryDraftRepository`インターフェース自体（`confirm(id, journalEntryRepository)`という2引数の設計）は変更していない。
**影響**: メインスレッド側（`Comlink.Remote<RepositoryRegistry>`経由）は`journalEntryDraft.confirm(id)`を1引数で呼び出す。今後、あるRepositoryインターフェースのメソッドが別のRepositoryインスタンス（またはメソッドを持つ他の非シリアライズ可能なオブジェクト）を引数に取る設計になる場合も、ドメイン層のインターフェース自体は変更せず、RPCレジストリ側（`createRepositoryRegistry.ts`）で該当引数をWorker内部の実インスタンスに結線した縮小シグネチャのラッパーとして公開する方針を優先する。

## 2026-08-01: Worker起動完了はpostMessageの専用メッセージ(WORKER_READY_MESSAGE)で通知し、メインスレッド側はこれを待ってからComlink.wrap()する

**背景**: sql.jsのWASM初期化は非同期であり、`new Worker(...)`の生成が完了した時点でメインスレッド側は直ちに`Comlink.wrap()`してRPC呼び出しを送信できる状態になる一方、Worker側のスクリプト実行（WASM読み込み・マイグレーション適用・`Comlink.expose()`によるメッセージリスナー登録）はまだ完了していない。この間にメインスレッドからRPC呼び出しを送ると、Worker側にComlinkのリスナーがまだ存在せず応答されずに消失する不具合を実機検証で発見した（Issue #24 Implementation Attempt 1）。
**決定**: Worker側（`db.worker.ts`）はDB初期化・マイグレーション・`Comlink.expose()`が完了した後にのみ、専用のライフサイクルメッセージ`WORKER_READY_MESSAGE`(`{ type: 'worker-ready' }`)を`postMessage`する。メインスレッド側（`createDbClient`）は`waitForWorkerReady`でこのメッセージを待ち受けてから`Comlink.wrap()`する。このメッセージはComlink自身がRPCに使うメッセージ（`id`を持つ）とは型で区別されるため、Comlink側のリスナーには無視され混線しない。
**影響**: `createDbClient`の戻り値は`Comlink.Remote<RepositoryRegistry>`から`Promise<Comlink.Remote<RepositoryRegistry>>`に変更された。今後Worker側の初期化処理（例: Issue #25で追加予定のStorageAdapterからの復元）に新しい非同期ステップを追加する場合も、`Comlink.expose()`より前に完了させ、`WORKER_READY_MESSAGE`の送出を初期化完了の最後に置く順序を維持する必要がある。

## 2026-08-01: Worker初期化失敗はworker-init-errorメッセージで伝播し、失敗時は生成済みWorkerをterminate()してからPromiseをrejectする

**背景**: Issue #24 Review Attempt 1で、Worker初期化（`db.worker.ts`の`main()`、WASM読み込み・マイグレーション適用等）が失敗した場合にメインスレッド側へ一切通知されず、`createDbClient()`が返すPromiseが無期限にハングする欠陥がevaluatorのFAIL指摘(重大度MEDIUM)として発覚した。原因は`void main()`でWorker内の非同期処理を呼び出しており、rejectされたPromiseが`.catch()`されず握りつぶされていたこと、および`createDbClient`側の`new Promise((resolve) => {...})`に`reject`を呼ぶ経路が存在しなかったことの2点だった(詳細は`docs/guides/patterns.md`「Web Worker等の非同期初期化をPromiseでラップする際、resolveのみ実装しrejectの経路を用意し忘れる」参照)。この修正(Attempt 2)で一旦PASS判定を得たが、Human Override REJECTにより「初期化失敗時、生成済みの`Worker`インスタンス自体が`terminate()`されないまま参照を失う(将来リトライ導線を実装した場合にWorkerが破棄されず溜まっていく)」という追加の問題が指摘され、Attempt 3で対応した。
**決定**: Worker側は`main()`を`.catch()`し、失敗時は成功時の`WORKER_READY_MESSAGE`とは型で区別できる`worker-init-error`メッセージを`postMessage`する。メインスレッド側は`waitForWorkerReady`が`worker-init-error`メッセージまたは`error`イベント(スクリプト自体の読み込み失敗等、Worker内の`try/catch`では捕捉できないケース)の両方を受けて`reject`するようにした。さらに`waitForWorkerReadyOrTerminate`で`waitForWorkerReady`をラップし、失敗時のみ生成済みの`Worker`インスタンスを`terminate()`してから元のエラーを再スローする構成にした。`createDbClient`はこの`waitForWorkerReadyOrTerminate`を使う。
**影響**: Worker初期化に失敗しうる要因(WASMアセットの配信失敗、マイグレーション例外、Issue #25で追加予定のストレージからの復元失敗等)はいずれも、呼び出し元に例外として確実に伝播するようになり、失敗したWorkerインスタンスが`terminate()`されずに残ることもない。今後Worker起動シーケンスに新しい失敗しうるステップを追加する場合も、この`worker-init-error`メッセージ経由のエラー伝播の仕組みに乗せる(新たな成功/失敗の通知経路を個別に作らない)。

## 2026-08-02: withAutoSaveの永続化トリガーはRepositoryの汎用ラップではなくDatabase#run単体の監視とし、トランザクション境界(BEGIN〜COMMIT/ROLLBACK)ごとに1回save()を呼ぶ

**背景**: Issue #25で`docs/architecture.md` 4.2節の`StorageAdapter`へDB変更を自動永続化する仕組み(`withAutoSave`)を実装するにあたり、どの単位でトリガーするかを検討した。当初は全Repositoryインスタンスのメソッドをreflectionで汎用的にラップする案を検討したが、クラスメソッドはprototype上にありインスタンスの`Object.entries()`では取得できず、読み取りメソッドの命名も`find`/`list`/`count`と不統一で「書き込みかどうか」を名前から安全に判定できなかった。一方、既存コードは一貫して書き込みに`db.run()`、読み取りに`db.exec()`を使う規約を守っていた。また、トランザクション(BEGIN〜COMMIT/ROLLBACK)の途中でsave()すると、クラッシュ時に不完全な状態(例: 仕訳ヘッダーのみ保存され明細が未保存)がStorageAdapter側に残るリスクがある(`docs/guides/patterns.md`「新しいRepositoryメソッドが複数回のDB書き込みを伴う場合、確立済みのBEGIN/COMMIT/ROLLBACK規約を適用し忘れる」と表裏の関係にある懸念)。
**決定**: sql.jsの`Database#run`を1メソッドだけ差し替えて監視する方式を採用した。`run()`に渡されたSQL文字列の先頭が`BEGIN`ならトランザクション深度を+1、`COMMIT`/`ROLLBACK`なら-1し、深度が0に戻った時点(単発文の実行完了時、またはトランザクション完了時)にのみ`StorageAdapter.save()`をスケジュールする。デバウンスは行わず単純な即時save呼び出しとした(デバウンス自体は`docs/architecture.md` 4.2節の記載どおり別Issueで扱う)。
**影響**: `withAutoSave(db, storageAdapter)`を`createBrowserDatabase`後・`runMigrations`後に1回呼ぶだけで、既存Repository実装への変更は一切不要になった。今後新しい集約のRepositoryを追加する際も、書き込みに`db.run()`・読み取りに`db.exec()`を使う既存規約を守る限り自動的に永続化トリガーの対象になる。逆にこの規約から外れる書き込み方法(例: 将来`db.exec()`で書き込みを行うコードを書いてしまう)を導入すると、その変更はStorageAdapterへ永続化されないまま静かに失われるため注意が必要。

## 2026-08-02: sql.jsのdb.export()はqueueMicrotaskで遅延実行し、Repositoryのcreate()実装が依存するlast_insert_rowid()を壊さないようにする

**背景**: `withAutoSave`の実装中に、sql.jsの`db.export()`がSQLite内部の`last_insert_rowid()`をリセットする副作用を持つことを実機テストで発見した(`db.run(INSERT)` → `db.export()` → `db.exec('SELECT last_insert_rowid()')`が`0`を返すことを確認。詳細は`docs/guides/knowledge.md`)。既存のほぼ全Repositoryの`create()`実装は`this.db.run(INSERT...)`直後に`last_insert_rowid()`を読んで挿入行を取得する規約(10箇所以上)になっているため、`db.run()`のラップ内で同期的に`db.export()`を呼ぶとRepository層全体が壊れる。
**決定**: `withAutoSave`内の`db.export()`呼び出しは`queueMicrotask`で遅延実行し、`db.run()`の同期的な戻り値の中では呼ばないことにした。sql.jsのRepositoryメソッドは同期API(内部にawaitを挟まない)であるため、呼び出し元(Repositoryのメソッド)の処理は`db.run()`が返った時点で既に完結しており、マイクロタスクへ逃がせば`db.export()`は呼び出し元の同期処理が完全に終わった後にのみ実行される。
**影響**: 今後sql.jsの`db.export()`を扱うコード(例: エクスポート/インポート機能を実装する#26)を書く際は、直前・直後に`last_insert_rowid()`に依存するコードが実行される可能性がないか確認する必要がある。同期的な処理フロー中で`export()`を呼ぶ場合は、この規約を踏まえて呼び出しタイミングを慎重に選ぶこと。回帰テストは`withAutoSave.test.ts`の「run()呼び出し直後にlast_insert_rowid()を参照しても正しい値が取得できる」に残した。

## 2026-08-02: withAutoSaveのsave()失敗はfire-and-forgetのままログ+AutoSaveController.getLastSaveError()で事後検知できるようにする

**背景**: `withAutoSave`の`scheduleSave`は当初`queueMicrotask(() => { void storageAdapter.save(db.export()) })`という完全なfire-and-forgetで実装されており、`storageAdapter.save()`が失敗(IndexedDBのクォータ超過等)してもunhandled rejectionとして握りつぶされ、呼び出し元(Repositoryのメソッド)は既に同期処理を終えているため失敗を検知・伝播する経路が存在しなかった。Issue #24 Review Attempt 1で指摘・`docs/guides/patterns.md`に明文化済みの「Web Worker等の非同期初期化をPromiseでラップする際、resolveのみ実装しrejectの経路を用意し忘れる」と同種のリスクを、初期化ではなく永続化のホットパスで再導入していたとしてIssue #25 Review Attempt 1でFAIL指摘された。永続化処理は呼び出し元が既に同期的にリターンした後で発火するため、通常の`Promise`のreject伝播やErrorのthrowでは呼び出し元に届けられない構造的な制約がある。
**決定**: `withAutoSave`の戻り値を`void`から`AutoSaveController`(`{ getLastSaveError(): unknown }`)に変更した。`scheduleSave`内で`storageAdapter.save(db.export())`に`.then(onSuccess, onError)`を付け、失敗時は`console.error`でログに残しつつ直近の保存エラーをクロージャに保持、`getLastSaveError()`から取得できるようにした。成功時は保持したエラーを`null`に戻し、一時的な失敗からの回復も検知できるようにした。
**影響**: `db.worker.ts`側では`AutoSaveController`の戻り値を現時点では消費していないが、将来UI側で「保存に失敗しています」等の表示を行う際の受け口として利用できる(UIへの通知配線自体は計画Issue #25本文の除外事項でありスコープ外)。今後、呼び出し元が既に同期的にリターンしてしまうfire-and-forget的な非同期処理を新設する場合、Promiseのreject/例外送出による伝播ができない構造上の制約があることを踏まえ、「ログに残す」+「直近の失敗を事後的に取得できるハンドル(コントローラーオブジェクト)を返す」という組み合わせを優先する。

## 2026-08-02: FileSystemAccessStorageAdapterは非対応環境でIndexedDBへ自動フォールバックせず、明示的なエラー型をスローする

**背景**: `docs/architecture.md` 4.2節はFile System Access API（`showDirectoryPicker`）がChromium系のみ対応でFirefox/Safariでは非対応であることを既に明記していたが、`FileSystemAccessStorageAdapter`自体が非対応環境でどう振る舞うか（黙って`IndexedDBStorageAdapter`相当の挙動にフォールバックするのか、エラーにするのか）は未確定だった。計画Issue #57着手前にユーザーと協議し、方針を決定した。
**決定**: `FileSystemAccessStorageAdapter`のコンストラクタで`isFileSystemAccessSupported()`を用いて対応環境かどうかを判定し、非対応の場合は即座に`FileSystemAccessNotSupportedError`をスローする。`IndexedDBStorageAdapter`への自動フォールバックは行わない。どちらのStorageAdapterをインスタンス化するか（フォールバック先の選択）、および非対応環境向けの警告表示・代替導線は、このクラス自身の責務にせずUI側（別Issue）に委ねる。
**影響**: `FileSystemAccessStorageAdapter`を呼び出す側（UI層、別Issue）は、インスタンス化前に`isFileSystemAccessSupported()`で事前判定するか、コンストラクタの例外を`instanceof FileSystemAccessNotSupportedError`で捕捉して`IndexedDBStorageAdapter`等の代替へ切り替える設計にする必要がある。StorageAdapterの実装クラス自身に「複数の永続化方式のどれを使うか」を決めさせず、呼び出し側（UI/アプリケーション層）に選択責務を寄せるという方針は、今後StorageAdapterの実装を追加する場合にも踏襲する。

## 2026-08-02: IndexedDBの「単一object store・単一固定キーへのget/put」パターンをindexedDbSingleRecordStoreとして共通ヘルパー化する

**背景**: Issue #57で`directoryHandleStore`（`FileSystemDirectoryHandle`をIndexedDBに保存）を実装した際、既存の`IndexedDBStorageAdapter`（DBバイト列をIndexedDBに保存）とDB名/オブジェクトストア名/キー名以外ほぼ同一の「DB open（`onupgradeneeded`でストア作成）→ get/put → close」というコードを個別に実装してしまい、evaluatorレビュー（Review Attempt 1）でDRY違反として指摘された。
**決定**: DB名・DBバージョン・オブジェクトストア名・レコードキーをパラメータ化した`createIndexedDbSingleRecordStore<T>()`（`src/infrastructure/storage/indexedDbSingleRecordStore.ts`）を新設し、`IndexedDBStorageAdapter`と`directoryHandleStore`の両方をこのヘルパーを使う実装にリファクタした。ジェネリクス型`T`により、保存する値の型（`Uint8Array`/`FileSystemDirectoryHandle`）が異なっても同じ実装を再利用できる。
**影響**: 今後、IndexedDBに「単一のオブジェクトストアに固定キー1件だけを保存する」という同型の永続化ニーズが生じた場合（例: 他の設定値の永続化）は、個別にIndexedDB操作を書かず`indexedDbSingleRecordStore`を再利用する。複数レコード・複数キーを扱う要件が生じた場合はこのヘルパーの対象外であり、別途設計が必要。

## 2026-08-02: File System Access APIの型定義として@types/wicg-file-system-accessを採用する

**背景**: `FileSystemAccessStorageAdapter`の実装で`showDirectoryPicker`・`FileSystemDirectoryHandle#queryPermission`/`requestPermission`等のFile System Access API固有の型を使う必要があったが、TypeScript標準の`lib.dom.d.ts`にはこれらの型が含まれていなかった（TC39/WHATWG標準ではなくWICG提案段階のAPIであるため）。
**決定**: コミュニティメンテナンスの型定義パッケージ`@types/wicg-file-system-access`をdevDependenciesに追加し、`tsconfig.app.json`の`compilerOptions.types`に`wicg-file-system-access`を追加してグローバル型として取り込んだ。
**影響**: `package.json`に`@types/wicg-file-system-access`が追加された（実行時の依存ではなく型定義のみ、バンドルサイズへの影響なし）。今後、他のWICG提案段階・非標準ブラウザAPIを利用する際も、まずコミュニティの`@types/*`パッケージの有無を確認し、なければ独自の`.d.ts`を書く方針とする。

## 2026-08-02: FileSystemWritableFileStreamへのwrite()が失敗した場合、close()ではなくabort()を呼び元のエラーをそのまま伝播させる

**背景**: `writeDatabaseToFileHandle`の実装当初、`try { await writable.write(...); await writable.close() } finally { ... }`のような構造で、`write()`が失敗した場合でも後始末として`close()`を呼ぶ実装になっていた。しかしStreams仕様上、`write()`失敗後のストリームは既にerrored状態であり、その状態で`close()`を呼ぶと元のエラー（例: ディスク容量不足）ではなく別の`TypeError`で拒否される。`try/finally`構造ではこの`close()`由来の`TypeError`が本来伝播すべき元のエラーを上書きしてしまい、呼び出し元は真の失敗原因を受け取れなくなる問題がevaluatorレビュー（Review Attempt 1）で指摘された。
**決定**: `writeDatabaseToFileHandle`は`write()`が失敗した場合、`close()`を呼ばず`writable.abort()`を呼んでからストリーム操作由来のエラーではなく元のエラーをそのまま`throw`する構成にした。TDDでこの失敗パスを再現するテストをまずredにしてから修正した。
**影響**: 今後`FileSystemWritableFileStream`（またはStreams API全般のWritableStream）を扱うコードで書き込み失敗時の後始末を実装する際は、`close()`をtry/finallyで機械的に呼ぶのではなく、失敗パスでは`abort()`を使い元のエラーを保持する設計を優先する。回帰テストは`src/infrastructure/storage/databaseFileCodec.test.ts`に追加済み。

## 2026-08-02: withAutoSaveのデバウンス間隔は2秒とし、保存トリガーの検知(メインスレッド)と保存の実行(Worker)を分離する

**背景**: `docs/architecture.md` 4.2節「データ整合性上の注意点」が要求する「書き込みはデバウンスし、頻繁な書き込みを避ける」を計画Issue #58で実装するにあたり、デバウンス間隔と実装場所を決める必要があった。`withAutoSave`は`db.worker.ts`内、つまりWeb Workerのコンテキストで実行されるが、Workerには`document`が存在しないため、「ページ非表示時には確実に保存する」という目標に必要な`visibilitychange`イベント(Documentのイベント)をWorker内では購読できないという制約があった。着手前にユーザーと設計協議を行い方針を確定した。
**決定**: デバウンス間隔は**2秒**とした(統計取込・一括削除等の連続書き込みを1回にまとめる効果と、クラッシュ時のデータ損失ウィンドウの小ささのバランス値として合意)。責務は、デバウンスタイマーの管理・実際の`save()`実行はWorker側(`withAutoSave`)に残し、ブラウザのページライフサイクルイベント(`visibilitychange`/`pagehide`)の検知のみメインスレッド側(`flushOnPageHide`、`createDbClient.ts`から呼び出し)に置き、RPC越しの`AutoSaveController.flush()`で両者を橋渡しする構成にした。`visibilitychange`(`hidden`時)と`pagehide`は、実際のタブ閉じ/切り替えでどちらか一方のみが発火するブラウザ差を考慮し両方購読する。連続書き込みが2秒間隔より短く永久に続く場合`save()`が無期限に延期される可能性(maxWait機構なし)は認識した上で、個人利用の家計簿アプリでは想定しにくくYAGNIとして見送った。
**影響**: 保存トリガーの検知(ブラウザAPI依存)と保存の実行(Worker内、sql.js依存)が別スレッドに分離されたため、この境界をまたぐ変更(例: 新しいページライフサイクルイベントの追加)を行う際は、イベント購読はメインスレッド側、実際の永続化ロジックはWorker側という責務分担を維持する必要がある。デバウンス間隔(`SAVE_DEBOUNCE_MS`)を変更する場合は、この2秒という値が「連続書き込みの集約」と「データ損失ウィンドウ」のトレードオフとして明示的に選ばれた値であることを踏まえ、再度バランスを検討すること。maxWait機構が無いという制約は、将来「頻繁な書き込みが継続し保存が無期限に遅延する」問題が顕在化した場合の再検討課題として残る。

## 2026-08-02: RepositoryRegistryにRPC越しに公開するメソッド持ちオブジェクト(AutoSaveController)を追加する際、Comlink.proxy()でProxyMarkedを付与する

**背景**: 計画Issue #58で、メインスレッド側からWorker側の`AutoSaveController.flush()`をRPC越しに呼べるよう、`RepositoryRegistry`(`createRepositoryRegistry.ts`)に非RepositoryのキーとしてWorker側で生成済みの`AutoSaveController`をそのまま追加した(`autoSave`キー)。ここでComlinkの型定義上、`Comlink.expose()`されたオブジェクトのネストしたプロパティは既定で構造化複製可能な値(`Promisify<T>`、TypeScript上は`Promise<AutoSaveController>`)とみなされ、メソッド呼び出しの中継対象(`Remote<T>`)としては扱われないことが判明した(型エラーとしてlintで検出)。実装当初、このdocstringを「`journalEntryDraft.confirm`と同種の制約」と説明したが、evaluatorレビュー(Review Attempt 1、重大度LOW)で、`journalEntryDraft`は実際には`Comlink.proxy()`を使っておらず、問題の所在(Repositoryインスタンスを引数として渡せない vs. メソッド持ちオブジェクトをプロパティとして公開すると構造化複製対象とみなされる)も解決方法(縮小シグネチャのラッパーAPI vs. `Comlink.proxy()`)も別物であるという不正確な比較だったと指摘され、Attempt 2で訂正した。
**決定**: `RepositoryRegistry.autoSave`の型を`AutoSaveController & Comlink.ProxyMarked`とし、`createRepositoryRegistry`の実装側で`Comlink.proxy(autoSaveController)`を返すことで、`autoSave`をメソッド呼び出しの中継対象として明示した。
**影響**: 今後、Repository以外の「メソッドを持つオブジェクト」(例: 他の制御用ハンドル)を`RepositoryRegistry`のような`Comlink.expose()`対象のレジストリにプロパティとして追加する場合は、素のオブジェクトのままではRPC越しにメソッド呼び出しができない(型上も`Promise<T>`に落ちる)ため、必ず`Comlink.proxy()`でProxyMarkedを付与する必要がある。この制約は「Repositoryインスタンスを引数として渡せない」という既存の制約(`docs/decisions.md`「RPC越しに渡せないRepositoryインスタンス引数は、レジストリ内部で結線した縮小シグネチャのラッパーAPIとして公開する」)とは問題の所在(引数 vs. 公開するプロパティ自体)も対処方法(縮小シグネチャのラッパー vs. `Comlink.proxy()`)も異なるため、混同して比較しないこと(`docs/guides/knowledge.md`にも同内容を反映)。

## 2026-08-02: withAutoSave.flush()に、保存進行中の重複要求を1回だけコアレスして再実行するガードを追加する

**背景**: 計画Issue #58 Implementation Attempt 1のevaluatorレビュー(Review Attempt 1、重大度MEDIUM)で、`withAutoSave`の`performSave()`/`flush()`に保存処理が既に実行中かどうかを追跡する仕組みが無いことが指摘された。実ブラウザでタブを閉じる操作では`visibilitychange`(hidden化)の直後に`pagehide`が発火するのが一般的であり(`flushOnPageHide`が両方購読する設計理由自体がこの想定を示している)、ページを閉じるという最も確実な保存が必要な場面で`flush()`が短時間に2回呼ばれ、`storageAdapter.save()`が同時に2回実行されうる状態だった。現状の本番配線(`IndexedDBStorageAdapter`)ではIndexedDBのトランザクション直列化により実害は顕在化しないが、将来`FileSystemAccessStorageAdapter`(#57で実装済み、本Issueが解決しようとしている「クラウド同期フォルダとの書き込み競合」の主要対象)を配線した場合、同一ファイルに対し独立した`FileSystemWritableFileStream`が同時に開かれ、書き込み完了順序の逆転やクラウド同期クライアントとの競合を助長しうる。
**決定**: `withAutoSave`内部に`inFlightSave`(実行中の保存Promise)・`pendingRerun`(完了後に1回だけ実行する再実行Promise)を保持するコアレシングガード(`triggerSave()`/`runOnce()`)を追加した。保存が進行中の間に新たな保存要求(`flush()`の重複呼び出し、デバウンスタイマー発火との競合)が来た場合は、進行中の保存の完了を待ってから1回だけ改めて保存し直す(何度要求が重なっても再実行は1回にまとめる)。TDD(red→green)で、(1)保存進行中に`flush()`がもう一度呼ばれても多重実行されず完了後に1回だけ再実行される、(2)3回以上重なっても再実行は1回にまとまる、(3)デバウンスタイマー発火と`flush()`の競合、の3件のユニットテストを追加した(`createControllableStorageAdapter`という、save()の完了タイミングを外部制御し`maxConcurrentSaveCalls`を計測する専用テストダブルを新設)。
**影響**: 今後、複数の独立したイベント(本件の`visibilitychange`/`pagehide`のような、実ブラウザでほぼ同時に発火しうる別々のトリガー)が同じ非同期の副作用(本件の`storageAdapter.save()`)を呼びうる設計を追加する場合は、各トリガーを個別に実装するだけでなく、それらがほぼ同時に発火した場合の多重実行を防ぐガード(実行中のPromiseを保持し、新規要求は完了後に1回だけコアレスして再実行する設計)を最初から検討する必要がある。`docs/guides/patterns.md`にも同内容を反映した。

## 2026-08-02: バックアップインポートの検証(assertValidDatabaseSchema)は使い捨てDBへのrunMigrations適用より先に実行する

**背景**: 計画Issue #26の本文は着手前から「壊れたファイルや無関係なsql.js DBファイルをインポートとして通してしまわないか」を懸念点として明示していた。Implementation Attempt 1の`importDatabaseBackup`は、アップロードされたバイト列から生成した一時`Database`(scratchDb)に対し`runMigrations(scratchDb)`を`assertValidDatabaseSchema(scratchDb)`より先に実行していた。`runMigrations`は`PRAGMA user_version`が0(未マイグレーション)のDBに対してLocalBudgetの全`CREATE TABLE`群を無条件に実行して成功するため、①テーブルが1つも無い空のsql.js DBファイル、②LocalBudgetと無関係なテーブルしか持たない(テーブル名も衝突しない)sql.js DBファイル、のいずれも`runMigrations`適用後は`assertValidDatabaseSchema`の必須テーブルチェックを通過してしまう不備が、evaluatorレビュー(Review Attempt 1、重大度HIGH)で実機再現の上、指摘された。ユーザーが誤ってこの種のファイルをインポートすると、検証を通過して中身の無いバイト列がそのまま`storageAdapter.save()`され、リロード後に既存の家計簿データが全て消える結果になりうる、計画段階の懸念点がまさに顕在化した事例だった。
**決定**: `importDatabaseBackup`内の検証順序を「先に生のインポートバイト列そのものの構造を`assertValidDatabaseSchema`で検証し、LocalBudgetのDBだと確認できてから初めて`runMigrations`(古いバージョンのバックアップへの互換性確認)を適用する」順序に修正した(コミットa30e205)。この順序では、`runMigrations`が持つ「未マイグレーションDBへのテーブル新規作成」という副作用が検証より先に働くことがなくなる。修正を固定する回帰テストとして、`importDatabaseBackup`と同じ呼び出し順序で「空のsql.js DBファイル」「無関係なテーブルしか持たないDB(version=0)」の両方をインポートしようとすると`InvalidBackupFileError`を投げ既存データが保持されることを`e2e/backup-export-import.spec.ts`に追加した。
**影響**: 今後「検証用に一時的なリソース(DB・ファイル等)を生成し、検証してから本処理を行う」という設計を実装する際は、検証対象に対して副作用を持つ処理(本件のマイグレーション適用のような、対象を書き換えて「正しい状態」に近づけてしまう処理)を検証より先に走らせないよう注意する必要がある。検証は必ず「入力された生の状態」に対して行い、正規化・補正・移行的な処理は検証を通過した後にのみ適用する順序を優先する。同種の「アップロードされたデータの整合性チェック」を今後実装する際は、このIssue(#26)を具体例として参照できる。

## 2026-08-02: バックアップインポートは保存直前にautoSaveController.flush()を呼び、保留中のデバウンス保存によるインポート内容の上書きを防ぐ

**背景**: `withAutoSave`(Issue #58で導入)はDB変更をtrailing debounce(2秒、`docs/architecture.md` 4.2節)で`StorageAdapter`へ保存する。`importDatabaseBackup`はこの生きたDB接続とは別の一時的な`Database`で検証を行い、検証成功時は`storageAdapter.save(data)`でアップロードされたバイト列をそのまま永続化する設計(`docs/architecture.md` 8章)だが、インポート直前にユーザーが何らかの編集操作を行っていた場合、その編集に由来する`withAutoSave`の保留中デバウンスタイマーが残ったままインポートを実行すると、タイマーが後から発火して生きたdbの(インポート前の)状態を`save()`し、インポートしたバイト列を上書きしてしまう競合が実装時に発見された(計画Issue本文には明記されていなかった)。
**決定**: `importDatabaseBackup`は`storageAdapter.save(data)`を呼ぶ直前に`autoSaveController.flush()`を呼び、保留中のデバウンスタイマーを解消して即座に保存を確定させてからインポートの保存を行うようにした。これにより、インポートによる書き込みが必ず最後の書き込みになることが保証される。この経路はE2Eの往復テスト(`e2e/backup-export-import.spec.ts`)で検証している。
**影響**: 今後、`StorageAdapter.save()`を`withAutoSave`の管理下にある生きたdbとは別経路(バックアップインポートのような、生きたdbを介さない直接保存)から呼び出す機能を追加する場合は、保留中のデバウンス保存との書き込み順序競合が起きないか確認し、必要であれば同様に`autoSaveController.flush()`を直接保存の直前に呼ぶ設計を優先する。

## 2026-08-02: vite-plugin-pwaのSW登録はinjectRegister: falseに固定し、useRegisterSW側に一本化する

**背景**: 計画Issue #28で更新確認バナー(`UpdateBanner`)を`virtual:pwa-register/react`の`useRegisterSW`フックで実装するにあたり、`vite-plugin-pwa`の`injectRegister`オプション（既定値`'auto'`）をそのままにしておくと、ビルド後のHTMLに自動注入される独立したSW登録スクリプトと、`useRegisterSW`が内部で行うSW登録が二重に走ることが実機検証（本番ビルド+`playwright.pwa.config.ts`でのpreviewサーバー確認）で判明した。二重登録の状態では、新しいService Workerを検出した際の`updatefound`イベントが`useRegisterSW`側で正しく検出されず、`needRefresh`が更新されない（更新確認バナーが表示されない）不具合が発生した。
**決定**: `vite.config.ts`の`VitePWA()`設定で`injectRegister: false`を明示し、SW登録を`UpdateBanner`の`useRegisterSW`呼び出しのみに一本化した。HTML側への自動登録スクリプト注入は行わない。
**影響**: 今後`vite-plugin-pwa`の設定を変更する際、`useRegisterSW`（またはvanilla版の`registerSW`）をアプリケーションコード側で呼び出す構成を維持する限り、`injectRegister`は`false`のままにする必要がある。逆にアプリケーションコード側でSW登録を明示的に呼ばない構成に変える場合は、`injectRegister`を`'auto'`等に戻すことを検討してよい。詳細な技術的背景は`docs/guides/knowledge.md`参照。

## 2026-08-02: Service Worker新バージョンのE2Eデプロイ模擬はdist/sw.jsの直接書き換え+registration.update()で行う

**背景**: 更新確認バナー(`UpdateBanner`)・重なり順(`pwa-overlay-z-index.pwa.spec.ts`)のE2Eテストで、「新しいService Workerがデプロイされた」状況を模擬する必要があった。Playwrightの`page.route`/`context.route`でService Worker自身のスクリプト取得リクエストをインターセプトし新しい内容を返す方式をまず試みたが、Service Workerのスクリプト取得はブラウザ内部（Service Workerプロセス）が直接行うため、Playwrightのネットワークインターセプトの対象にならず機能しないことを実機検証で確認した。
**決定**: `playwright.pwa.config.ts`経由のE2Eでは、ビルド済み`dist/sw.js`を`readFileSync`/`writeFileSync`で直接書き換えてから、ページ内で`navigator.serviceWorker.getRegistration()` → `registration.update()`を呼ぶ方式を採用した。vite previewサーバーはリクエストの都度ファイルシステムから読み直すため、書き換え後の`update()`呼び出しで新しいSWとして検出される。テスト後は`finally`節で元の内容に書き戻す。
**影響**: 今後、Service Worker自体の内容を書き換えて新バージョンを模擬するE2Eテストを追加する場合も、ネットワークインターセプトではなくビルド成果物（`dist/sw.js`）を直接書き換える方式を踏襲する。この方式は`playwright.pwa.config.ts`（ビルド済み成果物をpreviewサーバーで配信する構成）であることが前提であり、devサーバー対象の通常のe2e（`playwright.config.ts`）では成立しない点に注意する。

## 2026-08-02: ボタン等のアクセントカラー使用箇所にはWCAG AA基準を満たす--accent-contrastを新設し、--accentとは別トークンとして使い分ける

**背景**: 計画Issue #28 Implementation Attempt 1のevaluatorレビュー（FAIL、重大度MEDIUM）で、`UpdateBanner`/`IosInstallPrompt`のボタンが使っていた`background: var(--accent)` + `color: var(--bg)`（白文字）の組み合わせが、ライトモードで実測コントラスト比約4.39:1となり、WCAG AA基準（通常テキストで4.5:1以上）を満たしていないことが指摘された。`--accent`自体は他の用途（枠線・背景の淡色表現等）で既に多数使われており、この値自体を変更すると既存の見た目に広く影響する。
**決定**: 白文字との組み合わせで約5.9:1を確保する新しい色`--accent-contrast`（ライトモード`#8f2fd9`）を`src/index.css`に追加し、白文字ボタンの背景色として`--accent`の代わりに使用する方針にした。ダークモードの`--accent`は白文字との組み合わせで既に約6.8:1を満たしていたため、ダークモードの`--accent-contrast`は`--accent`と同値のままとした。
**影響**: 今後、白文字（`--bg`）と組み合わせるボタン等のUI要素を新設する場合は`--accent`ではなく`--accent-contrast`を使う。`--accent`はコントラスト非依存の用途（枠線・淡色背景等）に限定して使い続ける。この使い分けの基準（コントラストを要求される用途かどうか）を踏まえずに`--accent`を安易に流用しないよう、新規コンポーネント実装時・レビュー時ともに確認する。詳細は`docs/guides/patterns.md`参照。

## 2026-08-02: IosInstallPromptにフォーカストラップ(自動フォーカス・Tab/Shift+Tab循環・Escapeクローズ)を実装する

**背景**: 計画Issue #28 Implementation Attempt 1のevaluatorレビュー（FAIL、重大度MEDIUM）で、`IosInstallPrompt`が`aria-modal="true"`を宣言しているにもかかわらず、実際のフォーカス制御（表示時の自動フォーカス、ダイアログ外へのTab移動の防止、Escapeキーでのクローズ）が一切実装されていないことが指摘された。`aria-modal="true"`はスクリーンリーダー等の支援技術に対する宣言に過ぎず、実際のフォーカス制御はコンポーネント側で実装する必要がある。
**決定**: 表示時に閉じるボタンへ自動フォーカスし、`keydown`リスナーでTabキー押下時にダイアログ内の先頭/末尾要素間で循環させ（`querySelectorAll(FOCUSABLE_SELECTOR)`で対象を都度取得）、Escapeキー押下時は「今後表示しない」チェック状態を反映した`handleClose`を呼ぶ実装にした。`handleClose`は`useRef`で最新のクロージャを保持し、`useEffect`の依存配列を`[visible]`のみに絞ることで、チェックボックスの操作（`dontShowAgain`の変更）のたびにeffectが再実行され、フォーカスが強制的に閉じるボタンへ戻ってしまう副作用を回避した。
**影響**: 今後、`aria-modal="true"`を持つモーダルダイアログを新設する場合は、この実装（自動フォーカス・Tab循環・Escapeクローズ・`useRef`で最新のクロージャを保持し依存配列を最小限にする手法）をひな形として踏襲する。回帰テストは`e2e/ios-install-prompt.spec.ts`（フォーカス位置・Tab循環・Escapeの3観点）に追加済み。

## 2026-08-02: position: fixedの複数コンポーネントのz-indexはDOM順に依存させず、モーダル/非モーダルの区分に基づき数値を明示する

**背景**: 計画Issue #28 Implementation Attempt 1のevaluatorレビュー（FAIL、重大度LOW）で、`UpdateBanner`（非モーダル）・`IosInstallPrompt`（モーダル）が共に`z-index: 1000`のままで、両者が同時に表示される条件（iOS Safariで新しいService Workerを検出した場合等）での重なり順が、実質的にApp.tsx内のDOM配置順にのみ依存する不安定な状態だったことが指摘された。
**決定**: `aria-modal="true"`の`IosInstallPrompt`のオーバーレイを常に`z-index: 1100`とし、非モーダルの`UpdateBanner`（`z-index: 1000`）より確実に前面に来ることを明示した。回帰テスト（`e2e/pwa-overlay-z-index.pwa.spec.ts`）は、DOM順に依存する座標ベースの検証（重なった要素のスクリーンショット比較等）ではz-index実装漏れを検出できないため、`getComputedStyle(el).zIndex`の数値そのものを比較する方式にした（一時的にz-indexを同値に戻すとテストがREDになることを確認済み）。
**影響**: 今後、`position: fixed`の複数コンポーネントが同時に表示されうる設計を追加する場合は、DOM順（コンポーネントの配置順）に重なり順を委ねず、モーダル/非モーダルの区分（またはそれに準じた優先度）に基づいてz-indexの数値を明示的に割り当てる。回帰テストもDOM順に依存する座標ベースの検証ではなく、computed z-indexの数値比較で書く。詳細は`docs/guides/patterns.md`参照。

## 2026-08-02: @vite-pwa/assets-generatorが依存するsharpの脆弱性対応でpackage.jsonにoverridesを追加する

**背景**: `@vite-pwa/assets-generator`（PWAアイコン一式の機械生成、Issue #28）が依存として引き込む`sharp`のバージョンに既知の脆弱性が含まれており、`npm audit`で検出された。`docs/architecture.md` 11章「サプライチェーンリスク」の方針に沿って対応が必要だった。
**決定**: `package.json`に`"overrides": { "sharp": "^0.35.0" }`を追加し、`@vite-pwa/assets-generator`が指定する旧バージョンではなく修正済みバージョンの`sharp`を強制的に解決させるようにした。`sharp`はアイコン生成（`npm run generate:pwa-icons`）時にのみ使われる開発時依存であり、アプリのランタイムには含まれない。
**影響**: 今後、npm依存のトランジティブ依存に脆弱性が見つかった場合、そのパッケージ自体を直接更新できない（間接依存のため）場合は`overrides`での強制バージョン指定を優先的に検討する。`overrides`は依存ツリー全体に影響するため、対象パッケージ（本件では`sharp`）の新バージョンが既存の直接依存側の期待するインターフェースと互換性があるか（`npm run generate:pwa-icons`が正常動作するか等）を確認してから適用する。
