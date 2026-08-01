# 実装ミスパターン

このドキュメントは、`evaluator` のレビューで指摘された実装ミスや、実装中にハマった注意点を蓄積するものである。
同じミスを繰り返さないよう、`planner`（計画時）と `evaluator`（レビュー時）が参照する。

`doc-updater` エージェントが `/pr`・`/after-pr`・`/update-docs` 実行時に、以下のいずれかに該当する変更があれば追記する。

- evaluator が FAIL として指摘した内容でパターン化できるものがある
- 実装中にハマった点がコードやコミット履歴から読み取れる
- 既存パターンの記述が実態と乖離している（修正）

## フォーマット

```
## <パターン名>

**症状**: どういう不具合・問題として現れるか
**原因**: なぜ起きるか
**対策**: 実装時に何に気をつけるべきか
**該当箇所（例）**: ファイルパス:行番号（あれば）
```

---

## ドメインドキュメントに明記した不変条件がDDLに反映されないまま実装が進む

**症状**: `docs/domain/<集約>.md`にライフサイクル制約（例: 特定フラグを持つレコードの削除・特定フィールド変更の禁止）が文章で明記されているにもかかわらず、対応する`docs/schema/<集約>.sql`のCHECK制約/TRIGGERにその制約が実装されない。Repository層のテストもハッピーパスや「よくある」制約（区分変更禁止・参照存在チェック等）は網羅されるが、明記されているのに未実装の制約はそもそもテストが書かれないため、実装者自身は気づけずレビューまで発覚しない。
**原因**: ドメインドキュメントの記述量が多く、フィールド定義の一部（例: `is_system_managed`のようなブール値フラグの意味論）に埋め込まれた制約は読み飛ばされやすい。DDL実装時は「既存の類似トリガーを同じパターンで書けば済む箇所」に意識が向きやすく、ドキュメント全文を制約の網羅的チェックリストとして読み直す工程が実装フローに組み込まれていないと抜け落ちる。
**対策**: DDL・Repositoryを実装する際は、対象テーブルに対応する`docs/domain/<集約>.md`の「フィールド定義」節・「ライフサイクル」節を項目ごとのチェックリストとして読み、各フィールド・各操作（作成/更新/削除/非アクティブ化）について「許可される変更」「禁止される変更」を洗い出してからDDL/テストに落とし込む。特に真偽値フラグ（`is_system_managed`等）は「フラグがTRUEのとき通常のCRUDから除外される操作は何か」を明示的に確認する。evaluatorのレビュー時も、完了条件チェックリストの機械的な充足確認だけでなく、ドメインドキュメントの該当節を読み直して未実装の制約が無いか照合する。
**該当箇所（例）**: `docs/schema/accounts.sql`（`prevent_delete_system_managed_account`・`prevent_non_name_change_on_system_managed_account`トリガー、コミット5f809e4で追加）、`docs/domain/accounts.md` 3.1、Issue #5 Review Attempt 1（evaluator FAIL指摘、重大度MEDIUM/LOW）

## 新しい集約のRepository実装時にドメイン層とインフラ層を分離し忘れる

**症状**: `docs/architecture.md` 10章はドメインロジックのユニットテストとDBアクセス層（Repository実装）の統合テストを分離する方針を定めているにもかかわらず、実装時にエンティティの型定義・Repositoryインターフェースに相当する形状・sql.jsによるSQL実装を`src/infrastructure/db/<集約名>Repository.ts`という単一ファイルにまとめて実装してしまう。DBアクセスを伴わない純粋なドメインロジック（例: 貸借バランス検証）を後から追加しようとした時に、置き場所がなく後追いでリファクタが必要になる。
**原因**: 最初の集約（Account）の実装時点ではCRUD＋DDL制約への準拠が中心で、DBに依存しない純粋なドメインロジックがまだ存在しなかったため、型定義とSQL実装を1ファイルにまとめても表面上は問題が起きず、2層分離の必要性に気づきにくい。
**対策**: 新しい集約のRepositoryを実装する計画時点で、`src/domain/<集約名>/<集約名>.ts`（型定義）・`src/domain/<集約名>/<集約名>Repository.ts`（Repositoryインターフェース、インフラ非依存）と、`src/infrastructure/db/SqlJs<集約名>Repository.ts`（上記インターフェースを`implements`するsql.js実装）の2層構成を最初から採用する（`docs/architecture.md` 5.1節参照）。貸借バランス検証等の純粋なドメインロジックはドメイン層に置く。
**該当箇所（例）**: `src/domain/account/Account.ts`・`src/domain/account/AccountRepository.ts`・`src/infrastructure/db/SqlJsAccountRepository.ts`（Issue #8でIssue #5実装を事後的にリファクタ）

## ドメインドキュメントに明記した不変条件が、アプリケーション層の検証ロジックにも実装漏れしうる

**症状**: `docs/domain/<集約>.md`に明記された不変条件（例: 「1件の仕訳は2件以上の仕訳明細から成る」`journal.md` 1.1）が、対応するアプリケーション層の検証関数（例: `assertJournalBalance`）に実装されないまま先に進む。ハッピーパス（バランスが取れた2行以上の仕訳）のテストは書かれるが、境界値（0件・1件）のテストケースが最初から用意されていないと、実装漏れに実装者自身が気づけない。上記「ドメインドキュメントに明記した不変条件がDDLに反映されないまま実装が進む」と同根の問題が、DDLだけでなくアプリケーションコード（Repository層のバリデーション）側でも起こりうることを示す実例。
**原因**: 不変条件の記述が「貸借バランスの一致」という主要な制約の隣接文脈（同じ節の1文目）に埋め込まれており、主要な制約（バランス一致）のテストを書く際に副次的な制約（最小明細数）を見落としやすい。境界値（0件・1件）は、正常系のテストケースを複製して作る際には想定されにくい。
**対策**: ドメイン層の検証関数を実装する際は、対応するドキュメント節から「検証すべき不変条件」を箇条書きで洗い出し、各条件について最低1つは境界値（0件・下限-1件等）のテストケースを先に書く。複数の不変条件を同じエラー型で表現する場合（本件では貸借不一致と明細数不足を両方`UnbalancedJournalEntryError`で表現）、原因を混同させない専用メッセージを持たせる（`debitTotal=0, creditTotal=0`のような値だけでは、貸借不一致なのか明細数不足なのか原因が分からないため）。
**該当箇所（例）**: `src/domain/journal/assertJournalBalance.ts`、`docs/domain/journal.md` 1.1、Issue #7 Review Attempt 1（evaluator指摘、コミットe4d33f4）・Attempt 2に対するHuman Override REJECT（コミット00466b1）

## 概念的に不可分な複数の書き込みを、独立したRepositoryメソッドの連結で実装するとロールバック保証が崩れる

**症状**: 消込仕訳の作成(`JournalEntryRepository.create`)とそれに対応するsettlesリンクの作成(`journal_entry_links`)を、呼び出し元が`create`→`createLink`と2回の独立したメソッド呼び出しとして連結する実装にすると、2回目の`createLink`がsettlesハード検証(`SettlementTagMismatchError`、`docs/domain/settlement.md` 1.8)で失敗しても、1回目の`create`で既にコミット済みの消込仕訳自体は残ってしまう。「検証に失敗したら何も書き込まれない」という設計原則(`docs/domain/journal.md` 1.3の「書き込み直前に検証し、不一致なら書き込みを行わない」パターン)が、2つの独立したトランザクションに分割したことで実質的に崩れる。
**原因**: `create`・`createLink`という既存の独立したRepositoryメソッドをそのまま呼び出し元(アプリケーション層)で連結するのが自然に見えるため、各メソッドが内部で個別にBEGIN/COMMITする独立したDBトランザクションであること、およびその結果2つの書き込みの間にall-or-nothing保証が働かなくなることに気づきにくい。
**対策**: ある操作の完了に、別の関連レコードの書き込みが不可分に伴う(両方成功するか両方失敗するかを要求するドメインルールがある)場合は、既存の独立したメソッドを呼び出し元で連結せず、片方の入力(例: `CreateJournalEntryInput.links`)としてもう片方の書き込み内容を受け取り、単一のRepositoryメソッド内の単一トランザクションでまとめて書き込む設計にする。実装・レビューの両方で「この2つの書き込みは同じトランザクションに属する必要があるか」を明示的に確認する。
**該当箇所（例）**: `src/infrastructure/db/SqlJsJournalEntryRepository.ts`(`create`内の`links`処理)、`docs/domain/settlement.md` 1.8、`docs/decisions.md`「settlesリンクの作成は消込仕訳自体の作成と同一トランザクションにする」、Issue #14 Review（evaluator FAIL指摘、コミット4b71565で修正）

## 新しいRepositoryメソッドが複数回のDB書き込みを伴う場合、確立済みのBEGIN/COMMIT/ROLLBACK規約を適用し忘れる

**症状**: `SqlJsJournalEntryRepository.create`/`update`等で既に`this.db.run('BEGIN')`〜`try{...COMMIT}catch{ROLLBACK; throw}`という規約が確立されているにもかかわらず、新しい集約のRepositoryで複数回のDB書き込みを伴うメソッドを実装する際（例: `CounterpartyRepository.merge`が統合元IDごとにループしながら`UPDATE journal_lines`→`UPDATE counterparty_patterns`→`INSERT INTO counterparty_merge_log`を実行）、単一のRepositoryメソッド内で完結しているという理由から見落とし、明示的なBEGIN/COMMIT/ROLLBACKを付け忘れる。ループの途中で例外（例: 存在しないIDに対する`findById`のnullチェック失敗）が発生すると、それより前のループ回で実行済みの書き込みだけがコミットされたまま残り、中途半端な統合状態がDBに残る。上記「概念的に不可分な複数の書き込みを、独立したRepositoryメソッドの連結で実装するとロールバック保証が崩れる」と症状は似るが、こちらは複数のRepositoryメソッドを呼び出し元で連結したのではなく、単一メソッド内部でのBEGIN/COMMIT忘れが原因である点が異なる。
**原因**: 「1つのメソッド内で完結する処理だから暗黙にトランザクション的である」という誤った直感が働きやすい。実際にはsql.js（SQLite）はデフォルトでautocommitモードであり、明示的にBEGINしない限り`db.run`の呼び出しごとに個別コミットされるため、メソッドの呼び出し境界とDBトランザクションの境界は自動的には一致しない。特にループ内で複数のSQL文を発行するメソッドでは、1回のメソッド呼び出しに何回のコミットが発生しているか意識しづらく見落としに気づきにくい。
**対策**: 複数回のDB書き込みを行うRepositoryメソッド（特にループ内で複数のSQL文を発行するもの）を新規実装する際は、そのメソッド全体を`this.db.run('BEGIN')`〜`try{...; this.db.run('COMMIT')}catch(error){this.db.run('ROLLBACK'); throw error}`で囲み、既存の`SqlJsJournalEntryRepository.create`/`update`と同一の規約に揃える。実装計画時・レビュー時の両方で「このメソッドは2回以上のDB書き込みを発行するか」を確認し、該当する場合は途中で失敗した際に先行する書き込みもロールバックされることを直接検証するテスト（例: 一部の入力のみ不正な状態でメソッドを呼び、例外送出後に先行分の書き込みが行われていないことを確認する）を追加する。
**該当箇所（例）**: `src/infrastructure/db/SqlJsCounterpartyRepository.ts`の`merge`（Issue #16 Review Attempt 1でevaluator FAIL指摘、コミット19cee61で`BEGIN`/`COMMIT`/`ROLLBACK`を追加して修正）、既存規約の参照元は`src/infrastructure/db/SqlJsJournalEntryRepository.ts`の`create`/`update`

## 確立済みの「書き込み直前バリデーション」規約を新しい集約に適用する際、呼び出し忘れ・関連ファイルのdocstring更新漏れが連鎖しやすい

**症状**: `assertJournalBalance`(`SqlJsJournalEntryRepository.create`/`update`が書き込み直前に呼び出し、失敗時は`UnbalancedJournalEntryError`を投げてDBに一切書き込まない、`docs/domain/journal.md` 1.3)という確立済み規約があるにもかかわらず、新しい集約でDBアクセス不要な同種の純粋バリデーション関数(例: `assertValidRecurringSchedule`)を実装した際、(1) その関数自体は実装・単体テストされるが、肝心のRepository実装(`create`/`update`)からは呼び出されておらず、自身のテスト内でのみ実行される実質デッドコードのまま提出される、(2) 呼び出し忘れの指摘を受けて実装側(`SqlJsXxxRepository.ts`)のdocstringだけ修正し、ポート側(ドメイン層の`XxxRepository.ts`インターフェース)のdocstringが「DDL側で強制され、実装は例外をそのまま伝播させる」という古い記述のまま矛盾して残る、という2段階の指摘漏れが連続して起きた。
**原因**: 純粋なバリデーション関数自体を実装しテストすることに意識が向きやすく、それをRepository実装から呼び出す「配線」の工程が独立したチェック項目として意識されにくい。また、ポート(インターフェース)とインフラ実装(sql.js実装)の2ファイルに同じ制約について同内容のdocstringが重複して存在する構成(`docs/decisions.md`「AccountRepositoryをドメイン層とインフラ層に分離する」参照)では、片方を修正した際にもう片方も同時に見直す意識が働きにくい。
**対策**: DBアクセス不要な純粋バリデーション関数を新設する際は、実装計画時点で「この関数はどのRepositoryメソッドの書き込み直前から呼び出されるか」を明示し、関数自身の単体テストとは別に、呼び出し元のRepository層テストで対応するドメインエラーの`instanceof`が実際にスローされることを検証する(関数自身の単体テストだけでは配線漏れを検出できない)。また、Repositoryのポート(`src/domain/<集約>/<集約>Repository.ts`)とsql.js実装(`src/infrastructure/db/SqlJs<集約>Repository.ts`)は同一の制約について同じ内容のdocstringを持つ構成であるため、一方の記述を修正した際は必ずもう一方も読み合わせて矛盾がないか確認する。evaluatorのレビュー時も、既存の確立済み規約(`assertJournalBalance`等)がある場合はその呼び出し箇所・関連ファイル全てへの反映漏れがないか横展開でチェックする。
**該当箇所（例）**: `src/infrastructure/db/SqlJsRecurringTransactionRuleRepository.ts`(`create`/`update`冒頭の`assertValidRecurringSchedule`呼び出し、コミット52ab664で追加)、`src/domain/recurring-transaction/RecurringTransactionRuleRepository.ts`(ポート側docstring、コミットd1270c3で修正)、Issue #18 Review Attempt 1・Attempt 2(evaluator FAIL指摘)
