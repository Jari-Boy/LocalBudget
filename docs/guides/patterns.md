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

## PL行に複数の直交軸(project_id/household_member_id/counterparty_id)を組み合わせる際、一部の軸を設定し忘れる

**症状**: `journal_lines`のPL科目(revenue/expense)行に`project_id`・`household_member_id`・`counterparty_id`を組み合わせて設定する必要がある場面(例: 割勘仕訳の費用行に支払者の`household_member_id`と精算相手の`counterparty_id`を両方設定する)で、一部の軸だけが設定され、他の軸が欠落したまま実装が提出される。`buildCounterpartyExpenseSplittingJournalEntryInput`の貸方費用行では`counterpartyId`のみが設定され、本来同じ行に必要な`householdMemberId`(支払者)が欠落していた。
**原因**: `docs/domain/counterparties.md` 1.1の「取引先はproject_id・household_member_idと合わせた4本目の直交軸」という記述は各軸が独立に設定可能であることは示すが、「複数の軸が同一行に併存しうる(排他的ではない)」ことを明示していないため、実装時に「この行にはどれか1つの軸を設定すればよい」と誤解しやすい。ドメインドキュメントの仕訳例(`docs/domain/expense-splitting.md` 1.4節の「食費(A)」のような暗黙のhousehold_member_id表記)は人間には読み取れるが、コード生成時に見落とされやすい。
**対策**: PL科目の行を組み立てる際は、その行に適用されうる軸(`project_id`・`household_member_id`・`counterparty_id`)を`docs/domain/journal.md` 2.1のフィールド定義表を基準に1つずつ洗い出し、ドキュメント中の仕訳例([例]ブロック)に暗黙的に含まれる軸(括弧内の人物表記等)も見落とさず引き写す。特に、既存の関連行(例: 元仕訳の対応する行)から値を引き継ぐ必要がある軸(支払者のhousehold_member_id等)は、新規に発生する軸(counterparty_id等)を追加する際に上書き・削除されていないか確認する。
**該当箇所（例）**: `src/domain/expense-splitting/buildCounterpartyExpenseSplittingJournalEntryInput.ts`(コミット3dc2919で`householdMemberId`を追加)、`docs/domain/counterparties.md` 1.1、`docs/domain/expense-splitting.md` 1.4、Issue #22 Review Attempt 1(evaluator FAIL指摘)

## 「特定の軸だけが非ゼロ」の単独ケースを検証するテストで、対象外の軸に単一方向の明細しか計上せず意図せず非ゼロにしてしまう

**症状**: 「資産のみ非ゼロ」「負債のみ非ゼロ」のように特定の軸(科目)だけを非ゼロにして判定ロジックを検証するテストで、対象外の軸(科目)に借方または貸方いずれか一方だけの明細を計上してしまい、実際にはその軸の残高も非ゼロ(区分の計算式によっては符号が反転した値)になってしまう。`isSettlementBalanceZero`の「紐づく資産科目のみ残高が非ゼロの場合」テストは、負債科目(id=2)に借方のみ3000を計上していたため、負債区分の計算式(`credit-debit`)により残高が`-3000`(非ゼロ)になり、実際には資産・負債の両方が非ゼロの状態(別テストの「両方非ゼロ」ケースと実質同じ)を検証していた。実装本体にバグはなかったが、完了条件が要求する「単独ケース」を正しく分離したテストが存在しないため、資産側だけを見て負債側を無視するようなバグがあっても検出できない状態だった。
**原因**: 「対象外の軸には明細を1本だけ置けば十分」という直感が働きやすいが、資産・費用(借方増加)と負債・純資産・収益(貸方増加)で「増加側」が逆になる(`docs/domain/financial-statements.md` 2.1「残高計算の一般式」)ため、借方・貸方いずれか一方だけの1行を置くと、区分によっては非ゼロ(場合により負の値)になる。区分ごとに計算式が異なることを意識せずfixtureを組み立てると、「対象外のはずの軸」が意図せず検証条件に混入する。
**対策**: 「特定の軸(科目)だけが非ゼロ」という単独ケースを検証するfixtureを書く際は、対象外の軸には(a)明細を一切計上しないか、(b)計上する場合は同額の借方・貸方を両方置いて残高を確実に0にする、のいずれかを徹底する。fixture作成時点で各科目の区分の「増加側」計算式に沿って残高を目視検算し、テストコード中にコメントとして残す。evaluatorのレビュー時も、「単独ケース」を謳うテストのfixtureが本当に他の軸をゼロにできているか、コメントの検算結果とテスト名の主張が一致しているかを確認する。
**該当箇所（例）**: `src/domain/project/isSettlementBalanceZero.test.ts`(「紐づく資産科目のみ残高が非ゼロの場合」テスト、コミットfcac001で修正)、Issue #12 Review Attempt 1(evaluator FAIL指摘、重大度MEDIUM)

## Web Worker等の非同期初期化をPromiseでラップする際、resolveのみ実装しrejectの経路を用意し忘れる

**症状**: Web Worker起動のような非同期初期化処理を`new Promise((resolve) => {...})`でラップした際、成功時のresolveパスのみを実装し、失敗時にPromiseをrejectする経路が存在しない。Worker内の初期化処理(`main()`)が例外をスローしても、`void main()`のように呼び出し元でcatchしていないと、Worker内のunhandled rejectionはメインスレッド側の`worker.onerror`/`error`イベントにも伝播せず握りつぶされる。結果、呼び出し元は初期化失敗時に何のフィードバックも得られないまま無期限にハングする。
**原因**: ハッピーパス(初期化成功)の実装・テストに意識が向きやすく、非同期処理をPromiseでラップする際に「失敗時にどうreject/エラー伝播させるか」を最初から設計に含めないと、成功パスのみのコードが一見動作するように見えてしまう。Node/Vitestのモック実行では気づきにくく、実際にWASM読み込み失敗等が起きうるブラウザ環境で初めて顕在化するため、実機(Playwright等)での失敗系シナリオの検証が抜けていると発見が遅れる。
**対策**: 非同期初期化をPromiseでラップする際は、resolve経路と同時に必ずreject経路を設計する。(1) 内部の非同期処理(Worker内の`main()`等)は`.catch()`または`try/catch`で確実に捕捉し、失敗を呼び出し元へ伝播させる専用のシグナル(例: 成功メッセージとは型で区別できる`worker-init-error`メッセージ)を用意する、(2) 呼び出し元は成功シグナルと失敗シグナルの両方をリッスンし、失敗時は`reject`する、(3) メッセージ経由の失敗だけでなく、スクリプト自体の読み込み失敗等`try/catch`では捕捉できない失敗にも備え、`error`イベントリスナーでの`reject`も併用する。加えて、失敗時に生成済みのリソース(Worker等)を`terminate()`等で確実に解放し、失敗のたびにリソースリークが起きないようにする。実装後は、実際に初期化を失敗させて(例: WASMアセットの読み込みを意図的に`abort`する)Promiseが確実にrejectされることを検証するテストを追加する。
**該当箇所（例）**: `src/infrastructure/rpc/createDbClient.ts`・`src/infrastructure/rpc/waitForWorkerReady.ts`・`src/infrastructure/rpc/waitForWorkerReadyOrTerminate.ts`・`src/infrastructure/worker/db.worker.ts`、`docs/decisions.md`「Worker初期化失敗はworker-init-errorメッセージで伝播し、失敗時は生成済みWorkerをterminate()してからPromiseをrejectする」、Issue #24 Review Attempt 1(evaluator FAIL指摘、重大度MEDIUM)・Human Override REJECT(terminate()漏れの追加指摘)

## sql.jsのdb.export()を書き込み処理の直後に同期的に呼ぶと、last_insert_rowid()に依存する既存コードが壊れる

**症状**: `db.run(INSERT ...)`の直後に`db.export()`(DB全体のシリアライズ)を同期的に呼ぶと、その後に`db.exec('SELECT last_insert_rowid()')`を呼んでも直前のINSERTで採番された値ではなく`0`が返る。既存のほぼ全Repositoryの`create()`実装は`this.db.run(INSERT...)`直後に`last_insert_rowid()`を読んで挿入行を取得する規約になっているため、書き込みを監視して自動的に`export()`するような仕組み(`withAutoSave`)を`db.run()`のラップ内で素朴に実装すると、Repository層全体の`create()`が壊れる。Node/Vitestの通常のRepositoryテストではRepositoryメソッドの外側で`export()`を呼ぶことはないため気づきにくく、DB変更の自動永続化のような「Repositoryの外側から書き込みを監視して副作用を挟む」機能を初めて実装した際に顕在化した。
**原因**: sql.jsの`db.export()`はSQLite内部の`last_insert_rowid()`をリセットする副作用を持つ(sql.js/SQLiteの一般的なドキュメントには明記されておらず、実機テストで発見)。これ自体はsql.jsのライブラリ仕様上の制約であり回避できないが、既存Repositoryの規約(`db.run(INSERT)`直後に同一のDB接続で`last_insert_rowid()`を読む)を知らずに、書き込み検知の実装だけを見て「`db.run()`の中でついでに`export()`しても良い」と判断すると影響範囲を見誤る。
**対策**: `db.export()`を書き込み処理に連動して呼ぶ仕組みを実装する際は、`last_insert_rowid()`に依存する呼び出し元のコード(同一のDB接続を使う限り、呼び出し元がRepositoryメソッド内であっても影響を受ける)が直後に実行される可能性を必ず確認する。sql.jsのRepositoryメソッドが同期API(内部にawaitを挟まない)であることを利用し、`export()`の実行を`queueMicrotask`等でマイクロタスクへ遅延させ、呼び出し元の同期処理が完全に終わった後にのみ実行されるようにする。実装後は「`run()`呼び出し直後に`last_insert_rowid()`を参照しても正しい値が取得できる」ことを直接検証する回帰テストを追加する。
**該当箇所（例）**: `src/infrastructure/storage/withAutoSave.ts`(`scheduleSave`を`queueMicrotask`でラップ)、`docs/guides/knowledge.md`「sql.jsのdb.export()はlast_insert_rowid()をリセットする副作用を持つ」、`docs/decisions.md`「sql.jsのdb.export()はqueueMicrotaskで遅延実行し、Repositoryのcreate()実装が依存するlast_insert_rowid()を壊さないようにする」、Issue #25 Implementation Attempt 1(実機テストで発見)

## fire-and-forgetな非同期の永続化処理でも、reject経路が無いことを理由にエラーハンドリング自体を省略してしまう

**症状**: `withAutoSave`の`scheduleSave`が`queueMicrotask(() => { void storageAdapter.save(db.export()) })`という完全なfire-and-forgetで実装され、`storageAdapter.save()`が失敗(IndexedDBのクォータ超過等)してもunhandled rejectionとして握りつぶされていた。呼び出し元(Repositoryのメソッド)は`db.run()`が返った時点で既に同期的にリターンしているため、この非同期処理はPromiseのreject伝播や例外のthrowで呼び出し元へ失敗を戻す経路を原理的に持たない。「呼び出し元に返す手段がない」という構造的な制約を、そのまま「エラーハンドリング自体を省略してよい」と誤読してしまい、`.catch()`もログ出力も一切ない状態で実装が提出された。既存の「Web Worker等の非同期初期化をPromiseでラップする際、resolveのみ実装しrejectの経路を用意し忘れる」パターンと根は同じ(非同期処理の失敗を誰も観測できない状態)だが、今回は初期化ではなく永続化のホットパスで、かつ「rejectする相手が存在しない」fire-and-forget構造という点で見た目が異なり、同種のパターンとして認識されにくかった。
**原因**: fire-and-forgetな呼び出し(`void promise`のように意図的に結果を待たない設計)は、呼び出し元へのreject伝播ができないこと自体は設計上正しい判断だが、「reject経路を作れない」ことと「エラーを一切扱わなくてよい」ことは別問題である。この区別が意識されないと、Promiseチェーンの外側にエラーハンドリングの必要性がないと誤解しやすい。
**対策**: fire-and-forgetな非同期処理を新設する場合も、`.then(onSuccess, onError)`または`.catch()`で必ず失敗を捕捉し、最低限`console.error`等でログに残してunhandled rejectionにしない。加えて、呼び出し元へ同期的に伝播できない以上、直近の失敗を後から検知できる受け口(例: 本件の`AutoSaveController.getLastSaveError()`のような、最後のエラーを保持し取得できるハンドル)を用意することを優先する。UIへの通知配線自体は別途のスコープ判断で省略してよいが、モジュール内でエラーを黙って握りつぶさないことは別問題として扱う。
**該当箇所（例）**: `src/infrastructure/storage/withAutoSave.ts`(`scheduleSave`、`AutoSaveController.getLastSaveError()`)、`docs/decisions.md`「withAutoSaveのsave()失敗はfire-and-forgetのままログ+AutoSaveController.getLastSaveError()で事後検知できるようにする」、Issue #25 Review Attempt 1(evaluator FAIL指摘、重大度MEDIUM)・Attempt 2で修正

## 新しいStorageAdapter実装が、既存のIndexedDB単一レコード保存パターンを個別実装してしまう(DRY違反)

**症状**: `IndexedDBStorageAdapter`が既に確立していた「IndexedDBの単一object store・単一固定キーに対する get/put(DB open→`onupgradeneeded`でストア作成→get/put→close)」というコードパターンがあるにもかかわらず、新しいIndexedDB永続化の要件(`directoryHandleStore`によるFileSystemDirectoryHandleの保存)を実装する際、DB名・オブジェクトストア名・キー名が異なることを理由に同じ構造のコードをゼロから個別実装してしまう。両者はDB名/ストア名/キー名以外ほぼ同一のコードだった。
**原因**: 保存する値の型(`Uint8Array` vs `FileSystemDirectoryHandle`)やDB名・ストア名が異なるため、一見「別物」に見え、既存実装が再利用可能な共通パターンであると気づきにくい。特にIndexedDBのAPI(`indexedDB.open`のイベントハンドラ構成)自体が定型的なボイラープレートであるため、「コピーして値だけ変える」実装が自然に見えてしまう。
**対策**: 新しいIndexedDB永続化ニーズを実装する前に、既存の`src/infrastructure/storage/`配下に類似のIndexedDB操作コードが無いか確認する。「単一のオブジェクトストアに固定キー1件だけを保存する」という同型の要件であれば、DB名・DBバージョン・オブジェクトストア名・レコードキーのみをパラメータ化した共通ヘルパー(`indexedDbSingleRecordStore`)を再利用するか、まだ無い場合はその場で切り出す。evaluatorのレビュー時も、新規追加されたIndexedDB操作コードが既存の同種実装(`IndexedDBStorageAdapter`等)と構造的に重複していないか確認する。
**該当箇所（例）**: `src/infrastructure/storage/indexedDbSingleRecordStore.ts`(共通ヘルパー、`IndexedDBStorageAdapter`と`directoryHandleStore`の双方をこれに統一)、`docs/decisions.md`「IndexedDBの『単一object store・単一固定キーへのget/put』パターンをindexedDbSingleRecordStoreとして共通ヘルパー化する」、Issue #57 Review Attempt 1(evaluator FAIL指摘)

## try/finally構造でストリームの後始末を書くと、close()失敗時のエラーが元のエラーを上書きしてしまう

**症状**: `FileSystemWritableFileStream`への`write()`が失敗した場合の後始末として、`try { await writable.write(...); await writable.close() } finally { ... }`のような構造で無条件に`close()`を呼ぶ実装にすると、Streams仕様上write失敗後のストリームは既にerrored状態であるため`close()`自体が別の`TypeError`で拒否され、`try`節で本来スローされるべきだった元のエラー(例: ディスク容量不足)が失われ、呼び出し元には無関係な`TypeError`だけが伝播する。
**原因**: 「成功時も失敗時も後始末としてclose()相当の処理を呼ぶ」という一般的なtry/finallyの直感が、Streams APIのようにストリームの状態(errored)によって後始末の正しい呼び出し方(`close()`ではなく`abort()`)が変わるAPIには当てはまらない。write失敗時にclose()を呼んでも構文上は例外なくエラーになる(気づきにくい二重の失敗)ため、正常系のテストだけでは発覚しない。
**対策**: Streams API(`WritableStream`/`FileSystemWritableFileStream`等)を扱うコードで書き込み失敗時の後始末を実装する際は、機械的な`try/finally`でclose()を呼ぶのではなく、失敗パス専用に`catch`節を設け`abort()`を呼んでから元のエラーをそのまま`throw`する。実装時はTDDで書き込み失敗を再現するテスト(モックした`write`/`getWriter`等が reject するケース)を先に書き、意図通り元のエラーが伝播することを確認してから実装する。
**該当箇所（例）**: `src/infrastructure/storage/databaseFileCodec.ts`(`writeDatabaseToFileHandle`)、`docs/decisions.md`「FileSystemWritableFileStreamへのwrite()が失敗した場合、close()ではなくabort()を呼び元のエラーをそのまま伝播させる」、Issue #57 Review Attempt 1(evaluator FAIL指摘)

## 複数の独立したイベントが同じ非同期の副作用をほぼ同時に呼びうる設計で、多重実行防止ガードを追加し忘れる

**症状**: `flushOnPageHide`がdocumentの`visibilitychange`(hidden時)とwindowの`pagehide`という2つの独立したイベントリスナーから、それぞれ`AutoSaveController.flush()`(`storageAdapter.save()`につながる非同期処理)を呼ぶ設計にしたところ、実ブラウザでタブを閉じる操作では`visibilitychange`(hidden化)の直後に`pagehide`がほぼ同時に発火するため、`flush()`が短時間に2回呼ばれ`storageAdapter.save()`が同時に多重実行されうる状態のまま実装が提出された。「両方のイベントを購読する」という設計判断自体(実装者のdocstringにも「どちらか一方が発火しないブラウザ差を考慮」と明記)が、両者がほぼ同時に発火しうることを示唆していたにもかかわらず、その帰結である多重実行への対処が伴っていなかった。IndexedDBのような内部で書き込みを直列化するStorageAdapterでは実害が顕在化しないため、ユニットテスト・e2eテストいずれでも見落とされやすい。
**原因**: 「複数のイベントを保険的に両方購読する」という判断と、「両方がほぼ同時に発火した場合に同じ副作用が多重実行されないようにする」という判断は本来セットで検討すべきだが、前者(取りこぼし防止)にのみ意識が向き、後者(多重実行防止)は別の問題として見落とされやすい。特に非同期処理(Promiseを返す関数)を複数箇所から呼ぶ設計では、同期的なコードと異なり「同時に2つの呼び出しが実行中である」状態が一見して分かりにくい。
**対策**: 複数の独立したトリガー(イベントリスナー・タイマー等)が同じ非同期の副作用を呼びうる設計を追加する際は、各トリガーを個別に実装するだけでなく、それらがほぼ同時に発火した場合に副作用(本件の`storageAdapter.save()`)が同時に多重実行されないかを必ず検討する。対策としては、実行中の処理をPromiseとして保持し、新たな要求が来た場合は(a)進行中の処理をそのまま再利用する、または(b)完了を待ってから1回だけコアレスして再実行する、のいずれかのガードを設ける。実装後は、実行中の処理を外部から制御できるテストダブル(例: `resolveAll()`を呼ぶまで完了しない`save()`を返すモック)を用意し、複数の要求がほぼ同時に来ても同時実行数が常に1であることを直接アサートするテストを書く(タイミング依存のe2eテストより、Promiseの解決タイミングを制御できるユニットテストの方が確実に検証できる)。
**該当箇所（例）**: `src/infrastructure/storage/withAutoSave.ts`(`triggerSave`/`runOnce`、`inFlightSave`/`pendingRerun`によるコアレシングガード)、`src/infrastructure/rpc/flushOnPageHide.ts`、`docs/decisions.md`「withAutoSave.flush()に、保存進行中の重複要求を1回だけコアレスして再実行するガードを追加する」、Issue #58 Review Attempt 1(evaluator FAIL指摘、重大度MEDIUM)・Attempt 2で修正

## 入力の妥当性検証より先に、その入力へ副作用を持つ処理(正規化・マイグレーション・補完等)を実行してしまい検証が形骸化する

**症状**: アップロードされたDBバイト列がLocalBudgetの正当なバックアップかどうかを、使い捨ての一時`Database`(scratchDb)上で検証する`importDatabaseBackup`が、`runMigrations(scratchDb)`を`assertValidDatabaseSchema(scratchDb)`より先に呼んでいた。`runMigrations`は`PRAGMA user_version`が0(未マイグレーション)のDBに対してLocalBudgetの全テーブルを新規作成する仕様であるため、テーブルが1つも無い空のsql.js DBファイルや、LocalBudgetと無関係なテーブルしか持たないファイル(version=0)であっても、`assertValidDatabaseSchema`が実行される時点では既に`runMigrations`によって必須テーブルが全て作られてしまっており、検証が常に(何を渡しても)通過してしまっていた。検証ロジック自体(`assertValidDatabaseSchema`)にはバグが無いにもかかわらず、呼び出し順序だけが原因で検証が実質無意味化する。
**原因**: 「検証してから本処理(マイグレーション適用)を行う」という直感的な順序と、「検証対象そのものを先に正規化・補完してから検証する方が安全に見える」という直感が両立しがたいことに気づきにくい。特に、検証対象への副作用(テーブルの新規作成)が「まさに検証したい性質(テーブルが揃っているか)」を上書きしてしまうケースでは、副作用の実行結果によって検証が常に成功する状態になり、実装者自身が正常系のテスト(正しいバックアップファイルのインポート)だけを見ていると気づけない。異常系(空ファイル・無関係なファイルの拒否)のテストを先に用意していないと発見が更に遅れる。本件は計画Issue本文が着手前に「懸念点」として明示的に警告していたリスクだったにもかかわらず、実装時にその警告を踏まえた対策を怠り、実際にバイパス可能な状態のまま提出された。
**対策**: ある入力(ファイル・バイト列・DTO等)を検証する関数を呼び出す直前に、その入力(または入力から生成した検証対象)を書き換えうる処理(正規化・デフォルト値補完・マイグレーション・自動修復等)を挟んでいないか必ず確認する。検証は常に「渡された生の状態」に対して行い、正規化的な処理は検証を通過した後にのみ適用する順序を優先する(本件の修正: 先に`assertValidDatabaseSchema`で生のインポートバイト列を検証し、LocalBudgetのDBだと確認できてから初めて`runMigrations`を適用する)。実装計画の時点で「このデータを壊れている/無効だと拒否できなければならない」という懸念点が明示されている場合は、実装後に検証がバイパスされていないかを実機で意図的に(空ファイル・無関係な構造のファイル等で)確認する回帰テストを必ず追加する。evaluatorのレビュー時も、検証関数の呼び出し位置の前後で検証対象に副作用を持つ処理が挟まっていないかを重点的に確認する。
**該当箇所（例）**: `src/infrastructure/backup/importDatabaseBackup.ts`(検証の呼び出し順序、コミットa30e205で`assertValidDatabaseSchema`を`runMigrations`より先に修正)、`e2e/backup-export-import.spec.ts`(回帰テスト)、`docs/decisions.md`「バックアップインポートの検証(assertValidDatabaseSchema)は使い捨てDBへのrunMigrations適用より先に実行する」、Issue #26 Implementation Attempt 1 Review(evaluator FAIL指摘、重大度HIGH)・Attempt 2で修正

## 新しいUIコンポーネントを実装する際、色コントラスト比を確認せず既存のアクセントカラーをそのまま流用する

**症状**: `UpdateBanner`/`IosInstallPrompt`のボタンで、既存の`--accent`（紫系アクセントカラー）を`background`に、`--bg`（白系背景色、実質白文字）を`color`にそのまま組み合わせて使ったところ、ライトモードでの実測コントラスト比が約4.39:1となり、WCAG AA基準（通常テキストで4.5:1以上）をわずかに下回っていた。`--accent`は既に他の用途（枠線・淡色背景等、コントラスト比が問題にならない用途）で広く使われていたため、「既存の色変数を使っているから問題ない」という直感が働きやすく、新しい組み合わせ（白文字の背景色として使う）固有のコントラスト要件を見落としやすい。
**原因**: 色変数（デザイントークン）は「その値自体が常にアクセシブルである」ことを保証しない。同じ色でも組み合わせる相手（背景か文字色か、どの色と組み合わせるか）によってコントラスト比は変わるため、既存の色変数を新しい用途（特に文字色と背景色の組み合わせ）に転用する際は、その組み合わせ固有のコントラスト比を都度確認する必要がある。
**対策**: 白文字・黒文字等とボタン背景色を組み合わせる新しいUI要素を実装する際は、既存の色変数をそのまま流用せず、実際の組み合わせでのコントラスト比を確認する（WCAG AA基準: 通常テキストで4.5:1以上）。基準を満たさない場合は、既存の色変数を変更して他の用途への影響を広げるのではなく、その用途専用の新しいトークン（例: `--accent-contrast`）を追加する。ダークモード等、配色によっては既存の色のままで基準を満たす場合もあるため、モードごとに個別に確認する。
**該当箇所（例）**: `src/index.css`（`--accent-contrast`の新設）、`src/components/UpdateBanner.css`・`src/components/IosInstallPrompt.css`、`docs/decisions.md`「ボタン等のアクセントカラー使用箇所にはWCAG AA基準を満たす--accent-contrastを新設し、--accentとは別トークンとして使い分ける」、Issue #28 Implementation Attempt 1 Review(evaluator FAIL指摘、重大度MEDIUM)

## aria-modal="true"のダイアログを実装する際、フォーカストラップ(自動フォーカス・Tab循環・Escapeクローズ)の実装を伴わない

**症状**: `IosInstallPrompt`は`role="dialog"` `aria-modal="true"`をマークアップ上宣言していたが、表示時にフォーカスをダイアログ内へ移動させる処理、Tabキーでダイアログ外の要素へフォーカスが漏れないようにする処理、Escapeキーでの閉じる操作のいずれも実装されていなかった。`aria-modal="true"`はスクリーンリーダー等の支援技術に対する宣言に過ぎず、実際のキーボード操作の挙動をブラウザが自動的に制御してくれるわけではないため、マークアップだけを見ると「モーダルとして正しく振る舞っている」ように誤認しやすい。
**原因**: `aria-modal`属性を付与すること自体でアクセシビリティ要件が満たされたと錯覚しやすいが、実際にはこの属性は支援技術向けのセマンティクスの宣言のみであり、キーボードでの実際の操作性（フォーカス管理）は別途JavaScriptで実装する必要がある。ハッピーパス（マウス操作での開閉）のみを確認すると、キーボード操作の不備には気づけない。
**対策**: `aria-modal="true"`を持つダイアログを新設する際は、(1)表示時にダイアログ内の適切な要素（閉じるボタン等）へ自動フォーカスする、(2)Tab/Shift+Tabキー押下時にダイアログ内の先頭/末尾要素間で循環させフォーカスがダイアログ外へ漏れないようにする、(3)Escapeキー押下でダイアログを閉じられるようにする、の3点を必ず実装する。Escapeキー等のハンドラが最新のコンポーネント状態（チェックボックスの選択状態等）を参照する必要がある場合は、`useRef`で最新のクロージャを保持し`useEffect`の依存配列を最小限（例: 表示状態のみ）に絞ることで、状態変化のたびにeffectが再実行されフォーカスが意図せずリセットされる副作用を避ける。E2Eテストでフォーカス位置・Tab循環・Escapeキーでのクローズを直接検証する。
**該当箇所（例）**: `src/components/IosInstallPrompt.tsx`（`FOCUSABLE_SELECTOR`によるTab循環、`handleCloseRef`による最新状態の参照）、`e2e/ios-install-prompt.spec.ts`、`docs/decisions.md`「IosInstallPromptにフォーカストラップ(自動フォーカス・Tab/Shift+Tab循環・Escapeクローズ)を実装する」、Issue #28 Implementation Attempt 1 Review(evaluator FAIL指摘、重大度MEDIUM)

## 複数のposition: fixedコンポーネントが同時に表示されうる設計で、z-indexをDOM配置順任せにしてしまう

**症状**: `UpdateBanner`（非モーダル）・`IosInstallPrompt`（モーダル）はいずれも独立した`position: fixed`のコンポーネントで、共に`z-index: 1000`のまま実装されていた。両者が同時に表示される条件（例: iOS Safariで新しいService Workerを検出した場合）での重なり順は、z-indexの数値ではなく`App.tsx`内でのDOM配置順にのみ依存する不安定な状態だった。同じz-indexの要素はDOM順で後に配置された方が前面に表示されるため、たまたま意図通りの見た目になっていても、コンポーネントの配置順を変更した途端に重なり順が崩れる。
**原因**: 個々のコンポーネントを独立に実装する際、z-indexの初期値をひとまず設定しておけば動いて見えるため、「複数のfixed要素が同時に表示されうるか」「その場合どちらが前面に来るべきか」という横断的な検討が漏れやすい。特にモーダル（操作をブロックすべき要素）と非モーダル（操作をブロックしない要素）が混在する場合、モーダルが常に最前面に来るという要件は自明に見えても、実装（z-indexの数値）に反映されているとは限らない。
**対策**: `position: fixed`の複数コンポーネントが同時に表示されうる設計を追加する際は、それぞれのz-indexをDOM配置順に委ねず、モーダル/非モーダルの区分（またはそれに準じた優先度）に基づいて数値を明示的に割り当てる（例: モーダルは非モーダルより大きい値）。回帰テストは、DOM順に依存する座標ベースの検証（要素の見た目上の重なりをスクリーンショット等で確認する方式）ではz-index実装漏れを検出できないため、`getComputedStyle(el).zIndex`で実際のz-index数値を比較する方式で書く。
**該当箇所（例）**: `src/components/UpdateBanner.css`・`src/components/IosInstallPrompt.css`（`z-index: 1000`/`1100`）、`e2e/pwa-overlay-z-index.pwa.spec.ts`、`docs/decisions.md`「position: fixedの複数コンポーネントのz-indexはDOM順に依存させず、モーダル/非モーダルの区分に基づき数値を明示する」、Issue #28 Implementation Attempt 1 Review(evaluator FAIL指摘、重大度LOW)

## role="alert"/role="dialog"等「Name from: author」ロールをPlaywrightのgetByRole(role, { name })で特定しようとして失敗する

**症状**: 更新確認バナー(`UpdateBanner`)の`role="alert"`要素をE2Eテストで`page.getByRole('alert', { name: '新しいバージョンが利用可能です' })`のように特定しようとすると、要素が見つからない（アクセシブルネームが空またはロール名自体と一致しない）。ARIA仕様上`alert`ロールは「Name from: author」（開発者が`aria-label`/`aria-labelledby`等で明示的に付与しない限り、子要素のテキストコンテンツから自動的にアクセシブルネームが計算されないロール）に分類されるため、`aria-label`を付けていない場合、`getByRole`の`name`オプションで子要素のテキストを期待通りに照合できない。
**原因**: `button`や`link`等の多くのロールは「Name from: contents」（子要素のテキストから自動的にアクセシブルネームが計算される）であるため、`getByRole(role, { name: '...' })`でテキスト内容を指定するテストの書き方に慣れていると、`alert`/`dialog`等の「Name from: author」ロールでも同じ書き方が通用すると誤解しやすい。
**対策**: `alert`/`dialog`/`status`等「Name from: author」に分類されるロールを持つ要素をE2Eテストで特定する場合は、(1)コンポーネント側で`aria-label`を明示的に付与し`getByRole(role, { name })`で特定する（`IosInstallPrompt`の`role="dialog"`はこちらを採用）、(2)`aria-label`を付与しない場合は`getByRole(role)`でロールのみ特定し、テキスト内容は別途`toHaveText`等で検証する（`UpdateBanner`の`role="alert"`はこちらを採用）、のいずれかを使う。実装するロールがどちらの分類か不明な場合はARIA仕様（WAI-ARIA仕様の各ロール定義の"Name from"欄）を確認する。
**該当箇所（例）**: `e2e/update-banner.pwa.spec.ts`（`getByRole('alert')`+`toHaveText`）、`src/components/IosInstallPrompt.tsx`（`aria-label="ホーム画面に追加"`付与）、Issue #28実装時に判明（コミットb9d63b1・2a04f0a）

## 意図的なスコープ限定（範囲を広げない判断）がコミットメッセージ・Issueコメントにのみ残り、コード上のコメントとして明記されない

**症状**: `i18n.ts`の`resources`定義が`common`名前空間のみを持つ実装は、「ドメイン別の名前空間(`account.json`等)は各UI実装Issue側が着手時に追加する」という意図的な設計判断の結果だったが、その理由がコミットメッセージ・Issueコメントにしか書かれておらず、コード自体には何のコメントも無かった。コードだけを読む後続の実装者(evaluator含む)には、これが「意図的にスコープを絞った結果」なのか「単なる実装漏れ」なのか判別できない状態だった。
**原因**: 実装中は自分自身がその場でスコープ限定の背景を把握しているため、コード上に明記しなくても一見問題ないように見える。しかしコミットメッセージ・Issueコメントは将来コードだけを読む場面(他のIssueでの参照時、evaluatorのレビュー時)で必ず参照されるとは限らず、コードから意図が読み取れない。
**対策**: 「意図的に何かを実装しない」「対応範囲をここまでに絞る」といったスコープに関する設計判断は、コミットメッセージだけでなく、対応するコードの直上にdocstring/コメントとして明記する。実装漏れとの見分けがつくよう、「なぜこれ以上広げないか」の理由もあわせて書く。evaluatorのレビュー時も、スコープが限定されている箇所を見つけたら、それが計画通りの意図的な限定かをコード上のコメントだけで判別できるか確認する。
**該当箇所（例）**: `src/infrastructure/i18n/i18n.ts`（`resources`定義直上のコメント、コミット7bd25f7で追加）、`docs/decisions.md`「i18nextのリソースファイルは名前空間ごとに分割し、本Issueではcommon.jsonのみを先行用意する」、Issue #29 Review Attempt 1（evaluator指摘）
- 再発例: `src/domain/statement-import/inferMappingDefinitionDraft.ts`（`ImportMappingDefinitionDraft`インターフェースが`CreateImportMappingDefinitionInput`の`dateFormat`・`externalIdColumn`を持たない理由、コミット41f0d1cでdocstringに追加）、Issue #48 Review Attempt 1（evaluator FAIL指摘、重大度MEDIUM）・Attempt 2で解消。同じ既知パターンが計画Issue本文の記述だけを根拠にコードへの明記を怠ると再発することを示す実例

## 複数フィールドが共通の候補プールから割り当てを行う推測ロジックで、1パスの処理順ベース実装にすると結果が処理順に依存する

**症状**: `inferMappingDefinitionDraft`(列マッピング定義ドラフトの推測)で、`dateColumn`→`descriptionColumn`→...と1フィールドずつ「ヘッダーで確定できなければ型ベースの候補を生成する」処理を行うと、まだヘッダーマッチングを試みていない後続フィールド(例: `balanceColumn`)がヘッダーで一意に確定できたはずの列が、先に処理される先行フィールド(例: `amountColumn`)の型ベースのフォールバック候補プールに紛れ込んでしまう。`FIELD_ORDER`の並び順を変えると出力される候補列が変わってしまう、処理順依存のバグになる。
**原因**: 各フィールドの判定を独立した逐次処理として実装すると、「あるフィールドが確定した列は他フィールドの候補から除外すべき」という制約が、まだ処理していない後続フィールドの確定結果には適用されない。1パスのループでは処理の途中で「全フィールドの確定状況」を把握できないため、後から確定するフィールドの情報を先行フィールドの判定にフィードバックできない。
**対策**: 複数の項目(フィールド)が共通の候補プール(本件では「CSVの列」)から排他的に割り当てられる推測・マッチングロジックを実装する際は、1パスの処理順ベースの実装を避け、(1)全項目についてまず高確度の判定(本件ではヘッダーキーワードマッチング)を先に行い確定済み項目・使用済みリソースを洗い出す、(2)未確定の項目についてのみ、確定済みで使用中のリソースを除外した上でフォールバック判定を行う、という2パス構成にする。実装後は、フィールドの処理順序(配列の並び)を入れ替えても結果が変わらないことを直接検証するテスト、または処理順に依存し得る具体的なfixture(本件のような、先行フィールド候補に後続フィールドの確定列が紛れ込みうる列構成)でのテストを追加する。
**該当箇所（例）**: `src/domain/statement-import/inferMappingDefinitionDraft.ts`(`claimedColumns`による2パス方式)、`docs/decisions.md`「列マッピング推測の候補確定は2パス方式(ヘッダー確定列を先に全フィールド分claimしてからフォールバック候補を生成)とし、フィールドの処理順に依存しない結果にする」、Issue #48 Implementation Attempt 1(実装中に自己発見、evaluator指摘ではない)
- 続報(2026-08-03、コミット9ec2454): 2パス方式の実装後も、`claimedColumns`による除外はヘッダーの曖昧マッチ(1件に絞れなかったヘッダー候補)を絞り込む経路には適用されておらず、型ベースのフォールバック経路にのみ適用されていた非対称な実装が残っていた(evaluatorレビューPASS後、実データでの動作検証で発覚)。共通の候補プールから複数フィールドが割り当てを行う設計で、候補確定の経路が複数(本件ではヘッダー一意マッチ・ヘッダー曖昧マッチの絞り込み・型フォールバックの3経路)ある場合は、除外ロジック(`claimedColumns`)を全経路に一貫して適用できているか確認する必要がある。さらに、独立した経路(ヘッダー曖昧マッチの絞り込み結果と型フォールバックの結果)がそれぞれ`debitColumn`・`creditColumn`を偶然同一の列に解決してしまい、実際には1列の符号付き金額であるにもかかわらず`debit_credit_split`と誤判定される問題も判明した。「各フィールドは独立した経路で解決されるため互いに整合しているはず」という前提は成り立たず、解決結果同士の意味的な整合性(本件では「出金列と入金列は異なる列であるべき」)を事後的に検証するチェックを別途設ける必要がある。詳細は`docs/decisions.md`2026-08-03の各エントリ参照。

## ヒューリスティックな推測ロジックは、evaluatorレビューをPASSしたテストfixtureだけでは実データでの精度不足を検出できないことがある

**症状**: `inferMappingDefinitionDraft`(CSVヘッダーからの列マッピング推測)はIssue #48実装(PR #66)時点でevaluatorのレビューをPASSし、用意していたテストfixture(実装者が想像した典型的なヘッダー例)は全件PASSしていた。しかしその後ユーザーが実際に保有する楽天カード確定/未確定・PayPayカード・楽天銀行の明細CSVで動作検証したところ、amountModeがクレジットカード明細でほぼ常に`null`になる、debitColumn/creditColumnが偶然同一列に解決されdebit_credit_splitと誤判定される等、既存のfixtureでは再現されなかった精度上の問題が複数発覚した(コミット9ec2454)。
**原因**: ヘッダーキーワードマッチングや値のパターンマッチングのような、外部データ(金融機関ごとのCSV表記)の表記ゆれに依存するヒューリスティックな推測ロジックのfixtureは、実装者が「ありそうな」ヘッダー文言を想像して書く。実在する金融機関の具体的な表記(「利用金額」列と「11月支払金額」のような月次内訳列が両方「金額」を含み曖昧になる、入出金が単一の符号付き金額列で提供される形式等)や、複数の判定経路(ヘッダー一意マッチ・ヘッダー曖昧マッチの絞り込み・型フォールバック)が独立に同じ列へ解決されうる組み合わせは、想像だけでは網羅しづらく、evaluatorのレビューも実装者が用意したfixtureとドメインドキュメントの記述内容を基準に行うため、この種のギャップは検出できない。
**対策**: ヘッダー文言のキーワードマッチングや値のパターンマッチングのような、外部データの表記ゆれに依存するヒューリスティックな推測ロジックを実装する場合、evaluatorレビューのPASS後であっても、可能な範囲で実際の外部データ(本件では手元の銀行/カード明細CSV)による動作検証を計画に含めることが望ましい。ただし実データそのものは個人情報を含みうるためリポジトリにコミットしない。実データ検証で判明した構造パターン(ヘッダー文言の表記ゆれ・列構成の特徴)のみを抽出し、それを模した架空のヘッダー・取引先名・金額を持つ回帰テストfixtureとして追加する。
**該当箇所（例）**: `src/domain/statement-import/columnKeywordDictionary.ts`(tier構造化)、`src/domain/statement-import/inferMappingDefinitionDraft.ts`(claimedColumns拡張・amountMode判定基準変更・debit≠creditチェック)、`src/domain/statement-import/inferMappingDefinitionDraft.test.ts`(実データ構造を模した架空fixture)、`docs/decisions.md`「推測ロジックの実データ検証は行うが、実データそのものはコミットせず判明した構造パターンを模した架空データのみをテストフィクスチャとする」、コミット9ec2454、Issue #48(PR #66作成後・マージ前の追加修正)

## CSPのようなグローバルな制約を新規導入する際、対象の脅威(XSS)以外に既存の周辺依存(WASMライブラリ・ビルドツールの開発モード)への副作用を見落とす

**症状**: `index.html`にCSP metaタグ（`script-src 'self'`等）を追加した際、CSPが本来対象とするXSS対策としては仕様通りに書けていたにもかかわらず、実機で動作確認すると2つの既存依存が機能しなくなった。(1) sql.js(SQLite WASM)の`WebAssembly.instantiate`が`CompileError`でAbortする、(2) Vite dev serverのCSSモジュールHMRが動的注入する`<style>`タグがCSP違反になる。いずれもCSPのディレクティブ自体（`script-src 'self'`、インラインスクリプト禁止）の記述としては誤りではなく、CSPが暗黙に制約する「WASMコンパイル」「開発時限定のインラインstyle注入」という、XSS対策そのものとは直接関係しない既存の周辺機能への副作用だった。
**原因**: CSPディレクティブの文言（`script-src`・`style-src`等）は仕様書やベストプラクティス集を参照すれば正しく書けるが、それが「既存のアプリが実際に依存している技術（WASMライブラリのコンパイル方式、ビルドツールの開発時専用の仕組み）を制約しないか」は、CSPの仕様書だけを読んでいても分からず、対象のアプリケーションを実機で動作確認して初めて判明する。特にビルドツールの開発モード限定の挙動（HMR等）は本番ビルドの動作確認だけでは再現せず見落としやすい。
**対策**: CSPのような、アプリ全体に効くグローバルな制約を新規導入・変更する際は、ディレクティブの文言が仕様として正しいかだけでなく、既存の主要な外部依存（WASM・iframe埋め込み・Web Worker等、`script-src`/`worker-src`等の対象になりうるもの）およびビルドツールの開発モードとビルド成果物の両方を実機（Playwright等）で動作確認する。特にWASMを使うライブラリを利用している場合は`'wasm-unsafe-eval'`の要否、開発時専用の仕組み（HMR等）を持つビルドツールを使っている場合はdev server実行時と本番ビルドの両方でCSP違反が出ないかを確認する。
**該当箇所（例）**: `index.html`(`'wasm-unsafe-eval'`)、`vite.config.ts`(`relaxCspForDevServer`)、`e2e/csp.spec.ts`、`docs/decisions.md`「CSPはHTTPヘッダーではなくindex.htmlのmetaタグとして配信し、script-srcに'wasm-unsafe-eval'を含める」「Vite dev server限定でCSPのstyle-srcを緩和するプラグイン(relaxCspForDevServer)を追加する」、`docs/guides/knowledge.md`、Issue #30(実装中に自己発見、evaluator指摘ではない)

## ComlinkのRemoteオブジェクト(typeofが'function'と判定されるProxy)をReactのuseStateにそのまま渡すと誤動作する

**症状**: `DbClientProvider`が`setClient(createdClient)`のようにComlinkの`Remote<T>`オブジェクトをReactの`useState`セッターへ直接渡すと、Node/Vitestのユニットテストでは問題なく動作するにもかかわらず、実ブラウザ(Playwright)でウィザードを操作すると`rawValue.apply is not a function`という実行時エラーでアプリ全体がクラッシュする。
**原因**: ComlinkのRemoteオブジェクトは内部的に`function(){}`をターゲットとした`Proxy`であり、`typeof`演算子で`"function"`と判定される。Reactの`useState`セッターは、渡された引数が関数の場合これを「前の状態を受け取り新しい状態を返す更新関数」とみなして`updater(prevState)`の形で呼び出す仕様(functional updates)を持つため、この判定にComlinkプロキシが引っかかり、意図せず`createdClient(prevState)`のような呼び出しが発生、Comlink側で`path=[]`のAPPLYメッセージがWorkerへ送信されるが対応する実体がなく例外になる。既存のE2Eテスト(`worker-rpc.spec.ts`)は`client.account.create(...)`のようなその場でのメソッドチェーンのみを検証しており、Remoteオブジェクト自体をReactの状態として保持するパターンは初めてだったため、モックを使うユニットテストや型チェックでは検出できず、実ブラウザでの操作でのみ顕在化した。
**対策**: ComlinkのRemote<T>オブジェクト(または内部的に関数をターゲットにしたProxy等、`typeof`が`"function"`になりうる任意の値)をReactの`useState`・`useReducer`の状態として保持する場合は、必ず`setState(() => value)`という関数でラップして渡し、Reactに更新関数として誤呼び出しさせない。この種の実行時限定の不具合は、モックオブジェクトを使うユニットテストだけでは再現できないため、Comlinkのプロキシオブジェクトを新しく状態として扱うコンポーネントを実装した際は、実ブラウザ(Playwright)での動作確認を行う。
**該当箇所（例）**: `src/infrastructure/rpc/DbClientProvider.tsx`(`setClient(() => createdClient)`)、`src/infrastructure/rpc/DbClientProvider.test.tsx`(関数として呼び出し可能なオブジェクトを渡す回帰テスト)、`docs/decisions.md`「ComlinkのRemoteオブジェクトをReactのuseStateへ渡す際は関数でラップする」、Issue #31(実装中に自己発見、Playwrightでの実機操作で判明)

## ユーザー入力の数値をDDLのCHECK制約に渡す前の検証で、比較演算子だけに頼るとNaNが素通りする

**症状**: `registerAccount`の初期残高ガードで、`input.initialBalance <= 0`という比較演算子のみで「初期残高なし」を判定すると、`<input type="number">`から`Number(value)`で変換した結果がNaNになる入力(数値として解釈できない文字列等)に対して`NaN <= 0`が常に`false`を返すため、ガードをすり抜けて`journal_lines`の`CHECK (amount > 0)`制約違反の例外が発生する。この例外は`accountRepository.create()`で資産科目を作成した後、初期残高科目・仕訳の作成処理の途中で発生するため、対応する初期仕訳を持たない状態がDBに残り、ウィザードはエラー処理も無いままフリーズする(evaluatorのレビューで3回の実装attempt(0以下のガード追加→NaN判定漏れの発覚→Number.isFinite()追加)を経て発覚・修正された)。
**原因**: JavaScriptの比較演算子(`<`・`<=`・`>`・`>=`)は、オペランドがNaNの場合は常に`false`を返す(NaNはIEEE 754仕様上どの値とも大小関係を持たない)。「0以下なら弾く」という直感的なガードを書く際、NaNという「0以下でも0より大きくもない」特殊値の存在が意識されにくく、正常系のテスト(有効な数値の入力)だけでは見落とされる。
**対策**: ユーザー入力(特に`<input type="number">`から変換した数値)をDBのCHECK制約や不変条件の検証に使う前は、比較演算子だけに頼らず`Number.isFinite()`で有限の数値であることを必ず確認する(`NaN`・`Infinity`・`-Infinity`のいずれも`Number.isFinite()`は`false`を返す)。境界値のテスト(0・負数・NaN・Infinityそれぞれ)を実装時に用意する。DDL制約違反の例外が複数レコードの作成処理の途中で発生する設計(本件は資産科目→初期残高科目→初期仕訳の順で作成)の場合、それ以前に作成済みのレコードが残る可能性も踏まえ、DDL制約に抵触しうる値はアプリケーション層で事前に弾く設計を優先する。
**該当箇所（例）**: `src/components/account-registration/registerAccount.ts`(`Number.isFinite(input.initialBalance)`によるガード)、`src/components/account-registration/registerAccount.test.ts`(NaN/Infinityの回帰テスト)、`docs/decisions.md`「registerAccountの初期残高は0以下だけでなくNumber.isFinite()でNaN/Infinityも除外して『初期残高なし』判定する」、Issue #31 Implementation Attempt 1・2 Review(evaluator FAIL指摘)・Attempt 3で修正

## trailing debounceで永続化するデータのE2Eテストで、無関係な既存データの存在だけをポーリング条件にすると保存完了を待てない

**症状**: `e2e/account-registration.spec.ts`でウィザード操作後のDB永続化完了を待つ際、「IndexedDBに何らかのデータが存在する」ことだけをポーリング条件にする実装だと、テストの事前準備(世帯メンバー作成等)の時点で既にその条件を満たしてしまい、後続のウィザード操作(口座作成)による保存完了を待たずにテストが先に進んでしまう。
**原因**: `withAutoSave`(計画Issue #58)はDB変更をtrailing debounce(2秒)で`StorageAdapter`へ保存するため、ウィザード操作の直後に`createDbClient()`で新しい接続を作って確認しても、保存が完了しているとは限らない。「何らかのデータの有無」のような粗いポーリング条件は、テスト内で先行する別の書き込み(事前準備データ)によって既に真になっている可能性があり、対象の操作(本件のウィザードでの口座作成)による保存が完了したことを正しく検知できない。
**対策**: DB永続化の完了をE2Eでポーリング待ちする際は、「何らかのデータが存在するか」ではなく、「対象の操作で書き込まれたはずの具体的なデータ(本件では口座名)がRepository経由で実際に確認できるか」をポーリング条件にする。汎用ヘルパーを用意する場合も、確認対象のデータを引数として明示的に受け取る設計にし、「何かが保存されていればOK」という曖昧な条件にしない。
**該当箇所（例）**: `e2e/account-registration.spec.ts`(`waitForAccountCreated`/`waitForHouseholdMemberCreated`)、`docs/architecture.md` 4.2節(`withAutoSave`のtrailing debounce)、Issue #31(実装中に自己発見、evaluator指摘ではない)

## デバウンス自動保存を持つフォームで、確定操作以外の離脱経路(戻るボタン等)のflushを実装し忘れる

**症状**: `JournalEntryForm`のデバウンス自動保存(2000ms)は確定操作(`handleConfirm`)では保留中の変更を明示的に保存してから処理を進めていたが、「戻る」ボタンは単に`onBack()`を呼ぶだけで、デバウンスタイマーの`useEffect`cleanup(タイマーのクリアのみ、保存はしない)に処理が委ねられていた。デバウンス完了(2000ms)前に「戻る」を押すと、直前の入力内容が下書きに保存されないまま失われる。
**原因**: useEffectのcleanup関数は「エフェクトの後始末(タイマー解除等)」という役割が直感的であり、「保留中の副作用(保存)を代わりに実行する」責務まで持たせるのは不自然に見える。確定操作の実装時には明示的にflush処理を書いたにもかかわらず、離脱経路が複数存在する(確定・戻る等)ことを俯瞰せず、確定操作以外の離脱経路にも同じ配慮が必要であることを見落としやすい。
**対策**: デバウンス等の遅延書き込みを持つフォームを実装する際は、確定操作だけでなく画面遷移を伴う全ての離脱経路(戻るボタン・キャンセル・タブ切り替え等)を洗い出し、それぞれの経路で保留中の変更を同期的にflushする処理を入れる。useEffectのcleanupにはタイマー解除等の後始末のみを担わせ、保存処理はユーザー操作の文脈が明確なイベントハンドラ側に一貫して置く。
**該当箇所（例）**: `src/components/journal-entry/JournalEntryForm.tsx`(`handleBack`・`cancelPendingSave`)、`docs/decisions.md`「フォームの『戻る』操作でも、デバウンス保存中の未確定入力を離脱前に同期的にflushする」、Issue #32 Review Attempt 1(evaluator FAIL指摘)

## 新しいUI画面を実装する際、既存画面が確立したデザイントークン・レイアウト規約を確認せず素朴なCSSを書いてしまう

**症状**: `JournalEntryForm.css`・`JournalEntryDraftListScreen.css`のAttempt 1実装は、独自の素朴なマージン調整程度のスタイルのみで、既存画面(`AccountRegistrationWizard.css`・`AccountListScreen.css`)が確立していたデザイントークン(`--border`/`--bg`/`--text-h`/`--accent-bg`/`--accent-contrast`/`--error-bg`/`--error`)・レイアウト規約(ルートコンテナの幅制約、input/selectの共通スタイル+focus-visible、buttonのhover/focus-visible/disabled状態)を一切踏襲しておらず、既存画面と並べるとVisual/UXの一貫性が崩れていた。
**原因**: 新しいコンポーネントのCSSファイルを新規作成する際、機能要件(フォームが動作すること)は満たせるため、見た目の一貫性という非機能的な観点は個別にレビューされない限り見落とされやすい。特に色変数・レイアウトパターンはコンポーネントごとに再定義しても一見動作する(壊れて見えない)ため、既存画面との比較を意識しないと気づけない。
**対策**: 新しいUI画面のCSSを実装する際は、ゼロから書く前に既存の確立済み画面(`AccountRegistrationWizard.css`・`AccountListScreen.css`等)のデザイントークン・レイアウト規約(`src/index.css`のCSS変数、ルートコンテナの幅制約、フォーム要素の共通スタイル、ボタンの状態別スタイル、エラー表示のスタイル)を確認し、独自のスタイルではなくまずそれらを踏襲する。evaluatorのレビュー時も、新規画面を既存の同種画面と並べて視覚的な一貫性(配色・余白・フォーカス表示等)を確認する。
**該当箇所（例）**: `src/components/journal-entry/JournalEntryForm.css`・`JournalEntryDraftListScreen.css`、`docs/decisions.md`「新規UI画面(JournalEntryForm・JournalEntryDraftListScreen)のCSSは既存画面のデザイントークンを踏襲する」、Issue #32 Review Attempt 1(evaluator FAIL指摘)

## 「不完全な入力行を送信対象から除外してRepository層の検証に委ねる」設計で、除外された行の欠落自体が整合性チェックを偶然すり抜けてしまう

**症状**: `docs/architecture.md` 12章の方針に沿って、`JournalEntryForm`の確定操作は必須項目が欠けた行(マイナス/ゼロ金額を含む)を個別に検証せず送信対象から除外し、貸借バランス検証は`JournalEntryRepository`の`UnbalancedJournalEntryError`に委ねる設計にしていた。しかしマイナス金額の行が除外された結果、残りの行だけで借方合計・貸方合計が偶然一致してしまうケースでは`UnbalancedJournalEntryError`が発生せず、ユーザーが意図しない内容(マイナス金額の行が欠落した仕訳)がエラーにもならず黙って確定されてしまう欠陥があった。
**原因**: 「不完全な行は下流の集約検証(貸借バランス)がいずれ検出してくれる」という前提は、除外された行の欠落自体が集約検証の対象から消えてしまう(貸借比較の対象自体からいなくなる)ケースには当てはまらない。貸借バランス検証は「残った行同士が釣り合っているか」を見るだけで、「何か行が除外されたこと自体」を検出する仕組みではないため、除外後にたまたま釣り合ってしまう入力の組み合わせでは沈黙してしまう。
**対策**: 「不完全な行を送信対象から除外し、集約的な検証(貸借バランス等)を下流の層に委ねる」設計を採用する場合、除外そのものが下流の検証を偶然パスさせてしまわないか(除外後の残りの入力だけで集約条件が意図せず成立してしまう組み合わせが存在しないか)を個別に検討する。存在する場合は、除外対象となる条件(本件ではマイナス/ゼロ金額)自体を確定操作の前段で明示的に検知し、ブロック+専用エラーメッセージで伝える。実装時はテストで「除外対象の行がある状態で残りの行だけ貸借が偶然一致する」ケースを明示的に用意し、確定がブロックされることを検証する。
**該当箇所（例）**: `src/components/journal-entry/journalEntryFormLine.ts`(`hasNonPositiveAmountInput`)、`src/components/journal-entry/JournalEntryForm.tsx`(`handleConfirm`冒頭のガード)、`docs/decisions.md`「金額欄がマイナス/ゼロの行がある場合、送信対象から除外するだけでなく確定操作自体をブロックする」、Issue #32(ユーザーレビューでの指摘)

## 候補が1件のみの場合に限定した自動選択ロジックを、単一候補のテストfixtureしか用意せず複数候補時の挙動を検証しないまま実装する

**症状**: `StatementImportUploadScreen`のマッピング定義選択で、`setDefinitionId(found.length > 0 ? found[0].id : null)`という実装は、候補が1件でも複数件でも常に配列の先頭を自動選択していた。`docs/domain/statement-import.md` 1.5手順1は「候補が1つなら自動選択、楽天カードの速報用/確定用のように複数あれば`label`で選択させる」と明記していたが、Issue #76時点では対象科目に紐づくマッピング定義の候補が常に1件(テストで用意するfixtureも1件のみ)だったため、この「候補数に関わらず1件目を選ぶ」バグは長期間表面化しなかった。同一Issue内で組み込みマッピング定義(楽天カードの確定/速報等)を追加し、同一`account_id`に複数候補が実際に存在するようになって初めて顕在化した(実装中に自己発見)。
**原因**: 「候補が0件なら選択なし、1件以上ならとりあえず1件目」という一見自然な実装が、「複数候補時はユーザーに選ばせる」という否定的な要件(自動選択してはいけない)を見落とす。テストfixtureが単一候補のケースしか用意していなかったため、複数候補時の挙動を検証するテストが存在せず、実装時にもレビュー時にも発覚しなかった。
**対策**: 「候補がN件以下なら自動選択、それを超えたら選択させる」という設計を実装する際は、境界値(0件・自動選択される最大件数・それを超える件数)それぞれについて期待される挙動(選択肢の表示・自動選択の有無)を明示的にテストする。特に「複数候補では自動選択しない」という否定的な要件は、ハッピーパス(単一候補のfixture)だけでは検証されないため、意図的に複数候補のfixtureを用意したテストを先に書く。
**該当箇所（例）**: `src/components/statement-import/StatementImportUploadScreen.tsx`(`found.length === 1 ? found[0].id : null`)、`src/components/statement-import/StatementImportUploadScreen.test.tsx`(複数候補時に自動選択されないことを検証するテスト追加)、`docs/domain/statement-import.md` 1.5手順1、Issue #76(組み込みマッピング定義追加作業中に自己発見、コミット9979290)

## 既存の科目選択制約関数を別の記帳経路(source_type)の画面にそのまま流用し、ホワイトリストの違いを見落とす

**症状**: `StatementImportReviewScreen`の相手勘定科目候補フィルタが、マニュアル起票(`journal-entry`ドメイン)向けに実装済みの`isManualEntryEligibleAccount`(`is_reconcilable = true`科目を除外する)をそのまま流用していた。`docs/domain/reconciliation.md` 1.2の直接記帳制限ホワイトリストは`source_type = 'external_import'`(CSV取込由来)を許可しているため、CSV取込のレビュー画面では口座間振替のように`is_reconcilable = true`科目同士を相手科目として選べるべきだが、この既存関数を流用したことで選択肢から除外され、選べなくなっていた(計画Issue #76 evaluator Attempt 1 FAIL指摘)。
**原因**: `is_reconcilable = true`科目を候補から除外するという制約は「マニュアル入力(`source_type = 'manual'`)ではそもそも記帳できない科目だから」という、特定の記帳経路(`source_type`)に紐づく理由に基づくものだった。既存の判定関数名(`isManualEntryEligibleAccount`)自体にその前提が現れていたにもかかわらず、「相手科目として選べるかどうかの判定」という表面的な目的が同じであるために、経路(`source_type`)が異なる新しい画面(CSV取込)でもそのまま再利用してしまった。
**対策**: 科目の選択可否を判定する既存の関数を別の記帳経路(`source_type`)の画面で再利用する前に、その制約がどの`source_type`を前提にしたものか(`docs/domain/reconciliation.md` 1.2のホワイトリスト等)を確認する。前提となる`source_type`が異なる場合は、関数名を流用元と区別できる形(本件の`isStatementImportCounterAccountEligible`)で新設し、docstringに両者の違い(除外条件がなぜ異なるか)を明記する。実装後は、流用元の関数では除外されていたはずの科目(`is_reconcilable = true`)が新しい画面では正しく選択できることを確認する回帰テストを追加する。
**該当箇所（例）**: `src/components/statement-import/statementImportEligibility.ts`(`isStatementImportCounterAccountEligible`)、`src/components/journal-entry/journalEntryFormLine.ts`(`isManualEntryEligibleAccount`)、`docs/domain/reconciliation.md` 1.2、`docs/decisions.md`「CSV取込レビュー画面の相手勘定科目候補は、マニュアル起票用のisManualEntryEligibleAccountを流用せず専用のisStatementImportCounterAccountEligibleを新設する」、Issue #76 Review Attempt 1(evaluator FAIL指摘、コミット24e65a2で修正)

## 確定前のプレビュー計算が、まだ永続化されていない今回の入力自身の効果を積み上げから見落とす

**症状**: `StatementImportReviewScreen`の残高照合が、対象科目の永続化済み(過去分)`journal_lines`のみから帳簿残高を計算していた。しかし`docs/domain/reconciliation.md` 1.5は「この新しいCSVの内容を仮に反映したとして」帳簿残高を計算すると明記しており、今回アップロードしたCSVバッチ自身の効果(まだ未確定・未永続化のレビュー中レコード)を含めるべき設計だった。過去分のみで計算した結果、正しく取り込めるCSVでも常に過去残高と外部残高がズレて見え、誤った不一致警告が表示されていた(計画Issue #76 evaluator Attempt 1 FAIL指摘)。この修正の直後、今度は逆に「確定版候補で『これは確定版です』を選んだレコードの置き換え対象(旧仕訳)」を過去分の積み上げから除外し忘れ、旧仕訳+新レコードが二重計上される別の不具合が発覚した(実装中に自己発見)。
**原因**: 「残高照合は`journal_lines`を集計する」という既存の`checkBalanceReconciliation`のインターフェースが、既に永続化済みのデータを渡すことを暗黙の前提にしているように見えたため、レビュー中でまだ永続化されていないレコード(`ImportedRecord`)も同じ集計に含める必要があるという設計文書の記述を実装時に見落とした。ドメイン層の関数自体(`checkBalanceReconciliation`)は永続化済み/未永続化を区別しない設計だったため、バグは関数側ではなく呼び出し側(どのデータを渡すか)にあった。続く二重計上バグも同根で、「重複防止フローの結果によって、過去分の一部が実質的に取り消される」という間接的な効果を積み上げ対象の絞り込みに反映し忘れたものだった。
**対策**: 「確定前のプレビュー画面で、まだ永続化されていない入力内容を含めた見込み計算を行う」という設計(レビュー画面・ドラフト機能等)を実装する際は、対応するドメインドキュメントの計算対象の記述(本件は`reconciliation.md` 1.5「今回取り込む分の草案」)を、既存の永続化済みデータのみを渡す実装のまま満たしたつもりにならないよう再確認する。加えて、レビュー画面内の他の判定結果(本件は重複防止フローの「確定版として置き換える」選択)が、見込み計算の対象データ(本件は過去分の積み上げ)に間接的な影響を与えないか(既存データの一部が実質的に取り消される等)を洗い出す。実装後は、「新規に取り込むCSVの内容を含めれば一致するが、過去分だけでは一致しないケース」「置き換え対象の旧仕訳を除外しなければ二重計上になるケース」をそれぞれ明示的にテストし、素朴な実装では検出できないことを確認したうえで回帰テストとして固定する。
**該当箇所（例）**: `src/components/statement-import/StatementImportReviewScreen.tsx`(`reconciliation`の算出、`pastAccountLines`+`review.records`の積み上げ、`replacedJournalEntryIds`による旧仕訳の除外)、`docs/domain/reconciliation.md` 1.5、`docs/decisions.md`「CSV取込レビューの残高照合見込みは、過去分のjournal_linesだけでなく今回アップロードするCSVバッチ自身の効果も積み上げて計算し、確定版候補への置き換え時は旧仕訳の効果を除外する」、Issue #76 Review Attempt 1(evaluator FAIL指摘、コミット24e65a2)・実装中の自己発見(コミットa57cf27)

## 同一ドメイン制約のガードを複数のUI操作経路に実装する際、一部の経路への移植を2度に渡って忘れる

**症状**: `StatementImportReviewScreen`で、相手勘定科目に非PL科目(資産・負債)を選んだ場合に取引先(`counterparty_id`)をクリアするガードを、まず相手科目セレクトのonChangeにのみ実装した(Attempt 1 FAIL指摘で追加)。次のレビュー(Attempt 2)で、取引先セレクトを直接操作する経路と一括割当てバナーの適用処理という別の2経路には同じガードが実装されておらず、非PL科目の`default_account_id`を持つ取引先を選ぶとDDLトリガー違反によりレビュー確定操作がサイレント失敗する不具合が再度指摘された。1つの画面に「取引先」「相手科目」を変更しうる操作経路(通常セレクト・一括割当て・初期計算)が複数存在する場合に、同じ制約の実装漏れが連続して発生した実例。
**原因**: 最初のFAIL指摘を受けて1経路(相手科目セレクトのonChange)にガードを追加した時点で「対応済み」という認識が生まれやすく、同じ制約が適用されるべき他の操作経路(取引先セレクト自体・一括割当て等、ユーザーが取引先または相手科目を変更しうる箇所すべて)を横断的に洗い出す工程が踏まれないと、局所的な修正で終わってしまう。
**対策**: あるドメイン制約(本件は「counterparty_idはPL科目の行にのみ設定可能」)に対応するガードを実装・修正する際は、その制約に抵触しうる全てのUI操作経路(通常のセレクトのonChange・一括操作の適用処理・初期表示計算等、値を変更しうる箇所すべて)を列挙してから、単一の共通関数(本件の`resolveEligibleCounterpartyId`)を新設してすべての経路がそれを呼び出す構成にする。1経路ずつ個別にガード条件を書き足す対症療法的な修正は、修正の都度「これで全部か」を確認する工程が省略されると再発しやすいため避ける。evaluatorのレビュー時も、同種の指摘(1回目)が入った場合は、修正が単一経路のみへのパッチになっていないか、対象となるべき全操作経路を横断してチェックする。
**該当箇所（例）**: `src/components/statement-import/StatementImportReviewScreen.tsx`(`resolveEligibleCounterpartyId`、コミット64b062b・1f036d5)、`docs/decisions.md`「取引先×非PL科目のガードは全経路共通のresolveEligibleCounterpartyIdへ一元化する」、Issue #77 Review Attempt 1・Attempt 2(evaluator FAIL指摘、2回連続)

## 取得系stateを依存配列に含む初期計算用useEffectが、そのstateを更新する別操作のたびに再発火し既存の編集内容を上書きする

**症状**: `StatementImportReviewScreen`の取引先推定・相手科目サジェストの初期計算(`computeInitialRecordStates`)を呼ぶ`useEffect`は、依存配列に`counterparties`(Repositoryから取得したstate)を含んでいた。取引先のインライン新規作成(`CounterpartyQuickAddSelect`)で`counterparties`stateが更新されるたびにこのeffectが再発火し、`computeInitialRecordStates`が全レコードの初期状態を再計算して`setRecordStates`で丸ごと上書きしてしまい、それまでにユーザーが行っていた手動選択・一括割当て・新規追加した取引先の選択結果が全て失われる重大な不具合になっていた。取引先を新規追加する操作自体は正常に完了して見える(取引先自体は作成される)ため、失われるのは「それ以前の編集内容」という別の状態であり、直接の操作対象からは気づきにくい。
**原因**: 「初期表示時に一度だけ計算すればよい処理」であっても、その計算に必要なデータ(`counterparties`)をuseEffectの依存配列にそのまま含めると、react-hooks/exhaustive-deps的には正しく見える一方、そのデータが後から別の操作(本件は同一画面内でのインライン新規作成)によって更新されうる場合、「初期表示時のみ実行したい」という意図と「依存配列の変化のたびに再実行される」というuseEffectの標準動作が食い違う。「一度だけ実行したいeffect」と「値の変化に追従して実行したいeffect」は見た目が似ているが要件が異なり、後から依存データを更新する操作を追加した時点で初めて問題が顕在化するため、実装当初は気づきにくい。
**対策**: データ取得・作成系のstate(Repositoryから取得した一覧等)を使う初期計算用のeffectを実装する際は、そのstateが同一画面内の他の操作(新規作成・編集等)によって後から更新されうるかを確認する。更新されうる場合、そのeffectの再実行がユーザーの既存の編集内容(本件は`recordStates`)を上書きする副作用を持つなら、依存配列の変化に追従させず、`useRef`等のフラグで「初回のみ実行」に明示的に制限する。`eslint-disable-next-line react-hooks/exhaustive-deps`でlintの警告を抑制する場合は、なぜ依存配列を意図的に不完全にしているか(何を再実行させたくないか)をコメントで明記する。実装後は、初期計算完了後に依存データを更新する操作(本件は取引先の追加)を行っても、既存の編集内容が保持されたままであることを検証する回帰テストを追加する。
**該当箇所（例）**: `src/components/statement-import/StatementImportReviewScreen.tsx`(`initialEstimationStartedRef`、コミット58d8edc)、`docs/decisions.md`「取引先推定の初期計算は一度きりの実行に制限する(initialEstimationStartedRef)」、Issue #77(Human Override REJECT対応中に自己発見)

## 1つの操作から呼ばれる非同期処理が複数の分岐に分かれる場合、送信中フラグの設定を一部の分岐にしか書かず連打防止ガードが片方で機能しない

**症状**: `StatementImportUploadScreen`の`handleUpload`は、CSVを新規パースして候補を絞り込む経路と、既に絞り込み済みの複数候補からユーザーが選んだ後に`finalizeUpload`を呼ぶ経路の2つに分かれていた。Attempt 1の実装では前者の経路の冒頭にのみ`setSubmitting(true)`が置かれており、後者の経路(複数候補から選択して確定するボタン操作)には無かった。「取り込む」ボタンの`disabled`条件は`submitting`stateに依存するため、後者の経路では既存突合レコード取得(`await findByAccount`)が完了するまでボタンが有効なままとなり、連打すると`finalizeUpload`が複数回呼ばれ`onUploaded`が二重に呼ばれうる状態だった(evaluatorのレビューAttempt 1 FAIL指摘)。
**原因**: 「`setSubmitting(true)`を呼んでボタンを無効化する」という連打防止ガードは、1つの非同期処理の入口に1箇所実装すれば足りるという直感が働きやすい。しかし同じボタン操作から呼ばれる処理が複数の分岐(本件は「新規パース」と「絞り込み済み候補からの確定」)に分かれている場合、各分岐の入口ごとに個別にガードを実装しないと、一部の分岐だけ連打防止が機能しない状態になる。片方の分岐(新規パースの経路)では正しく実装されていたため、レビューでも見落とされやすい非対称な実装漏れになった。
**対策**: 1つのボタン・操作から呼ばれる非同期処理が、早期リターンや条件分岐によって異なる非同期処理へ進む複数の経路を持つ場合、連打防止用の送信中フラグ(`setSubmitting(true)`等)は各分岐の内部ではなく、分岐が発生する前の関数冒頭で一度だけ設定し、以後の全分岐が確実にその効果を受けるようにする。実装後は、各分岐について「非同期処理が完了するまでボタンが無効化されたままであること」を個別に検証する回帰テストを用意する(片方の分岐だけをテストしていると、もう片方の分岐の実装漏れは検出できない)。
**該当箇所（例）**: `src/components/statement-import/StatementImportUploadScreen.tsx`(`handleUpload`冒頭への`setSubmitting(true)`移動、コミット6760040)、`src/components/statement-import/StatementImportUploadScreen.test.tsx`(複数候補選択時の連打防止回帰テスト)、Issue #78 Review Attempt 1(evaluator FAIL指摘)・Attempt 2で修正

## 新規UI画面に複数の独立した非同期書き込み操作がある場合、一部の操作にのみ二重送信防止ガード(isSubmitting)を実装してしまう

**症状**: `CounterpartyManagementScreen`(作成・編集・削除・非アクティブ化・統合確定という5つの独立した非同期書き込み操作を1画面に持つ)のImplementation Attempt 1で、`isSubmitting`によるボタン無効化ガードが一部の操作にしか実装されておらず、evaluatorのレビューでFAIL指摘された。`AccountRegistrationWizard`で確立した「処理中はボタンをdisabledにするsubmitting state」規約自体は既知のはずだが、1画面に独立した複数の書き込み操作(ボタン)が存在する場合、各操作ごとに個別にガードを実装し忘れるケースが、上記「1つの操作から呼ばれる非同期処理が複数の分岐に分かれる場合」(単一ハンドラ内の分岐の話)とは別の形で繰り返し発生している。evaluatorのレビューコメントでも、この種の実装漏れが新規UI実装のたびに指摘される既知パターンであることが言及された。
**原因**: 「submitting stateでボタンを無効化する」という規約自体は認知されていても、1画面内に独立した複数の非同期操作(本件は作成・編集・削除・非アクティブ化・統合確定)が存在する場合、実装時に各操作を個別のイベントハンドラとして書き進める過程で、ガードの実装が全操作に横展開されているかを俯瞰的に確認する工程が抜けやすい。ハッピーパスの動作確認(1回だけ操作する)ではガードの有無に関わらず問題なく動くため、連打(2回目のクリック)を明示的に試すテストが無いと気づけない。
**対策**: 1画面に複数の独立した非同期書き込み操作(ボタン)を持つUIを実装する際は、実装計画の時点で「この画面にはいくつの独立した非同期操作があるか」を列挙し、各操作について(1)冒頭で`isSubmitting`のガード(早期return)、(2)処理開始時の`setIsSubmitting(true)`、(3)完了時の解除(`finally`)、(4)対応するボタンの`disabled={isSubmitting}`、の4点が揃っているかをチェックリストとして確認する。実装後は、各操作について「Repository呼び出しの完了を待つ間はボタンが無効化され、連打しても1回しか実行されないこと」を検証する回帰テストを操作の数だけ用意する(1操作だけのテストでは他操作の実装漏れを検出できない)。画面全体で単一の`isSubmitting`stateを共有し、いずれかの操作が進行中は全ボタンを無効化する設計(操作ごとに個別のstateを持たない)にすると、実装・確認すべき箇所を1つの変数に集約できチェック漏れを減らせる。
**該当箇所（例）**: `src/components/counterparty-management/CounterpartyManagementScreen.tsx`(`isSubmitting`、コミット3ce5397で5操作全てに追加)、`CounterpartyManagementScreen.doubleSubmit.test.tsx`(5操作それぞれの回帰テスト)、`docs/decisions.md`「取引先管理画面の二重送信防止は画面全体で共有する単一のisSubmitting stateとする」、Issue #38 Review Attempt 1(evaluator FAIL指摘)・Attempt 2で修正

## 一覧のテキストとセレクトの選択肢テキストが同一DOM上に共存する画面で、getByTextが複数要素にマッチしてテストが失敗する

**症状**: `CounterpartyManagementScreen`のように、取引先一覧の`<li>`内のテキスト(例:「ローソン 東京日本橋店」)と、統合先を選ぶ`<select>`内の`<option>`テキストが同じ文言で同一画面上に共存する構成では、Testing Libraryの`screen.getByText('ローソン 東京日本橋店')`が一覧側・セレクト側の両方にマッチし、「複数要素が見つかった」というエラーでテストが失敗する。
**原因**: 同じマスタデータ(取引先名等)を「一覧表示」と「選択肢」の両方に使う画面では、同一のテキストがDOM上に複数回出現することが構造上避けられない。`getByText`はスコープを指定しない限りdocument全体を対象に検索するため、この種の重複に気づかず素朴に書くと衝突する。
**対策**: 一覧側の要素を特定したい場合は、`within(screen.getByRole('list'))`のように一覧のコンテナ(`<ul>`等、`role="list"`)へスコープを絞り込んでから`getByText`/`getByRole`を呼ぶ。同名の値がセレクトの選択肢としても存在しうる画面(マスタの一覧+統合/割当のような操作を同一画面に持つUI)を実装する際は、実装当初からこの絞り込みヘルパー(例: `findListItem`)を用意しておく。
**該当箇所（例）**: `src/components/counterparty-management/CounterpartyManagementScreen.doubleSubmit.test.tsx`・`CounterpartyManagementScreen.merge.test.tsx`(`within(screen.getByRole('list'))`、`findListItem`)、Issue #38(実装中に自己発見)

## 新しいUI要素を既存画面に追加する際、確立済みのスタイル・DOMセマンティクスを継承し忘れる

**症状**: `CounterpartyManagementScreen`に学習済みパターンの編集用`<input>`・展開一覧を追加した実装(Implementation Attempt 1)で、(1)パターン編集用`<input>`に、同じ画面の取引先フォーム(`.counterparty-form input`)が既に持つ角丸・パディング・テーマ色・フォーカスアウトラインのスタイルが適用されておらず素のブラウザ標準スタイルのまま表示されていた、(2)展開したパターン一覧を`<div>`の並びとして実装しており、同じ画面の取引先一覧(`<ul>`/`<li>`)とDOM構造(セマンティクス)が不統一だった。evaluatorのレビュー指摘を受け、`.counterparty-pattern-row input`へ取引先フォームと同一のスタイル定義を追加し、`<div>`を`<ul>`/`<li>`へ変更する修正が必要になった(コミットea924c0)。
**原因**: 新しいUI要素(本件はパターン編集用input・パターン一覧)を実装する際、機能要件(値の編集・削除ができること)を満たすことに意識が向きやすく、同一画面内に既に確立されている見た目・DOM構造の慣習(フォーム入力欄の共通スタイル、一覧要素の`<ul>`/`<li>`化)を横展開する工程が独立したチェック項目として意識されにくい。機能テスト(Vitest/Testing Library)は要素の存在・値の変更を検証できてもスタイル未適用やセマンティクスの不統一までは検出できないため、見た目のレビュー(evaluatorによる実装確認)まで気づかれにくい。
**対策**: 既存画面に新しいUI要素(入力欄・一覧・ボタン等)を追加する際は、実装前にその画面内の同種の既存要素(フォーム入力欄、一覧の`<ul>`/`<li>`構造等)を確認し、新要素にも同じCSSクラス構造・DOM要素種別を適用する。同一画面内で同じ役割(例: テキスト入力)の要素が複数箇所に存在する場合、個別にスタイルを重複定義するのではなく、可能であれば共通クラスの再利用を検討する(本件は`.counterparty-form input`と`.counterparty-pattern-row input`が同一のスタイル定義を重複して持っており、将来的な共通化の余地が残る)。一覧を新設する際は、その画面の既存の一覧が`<ul>`/`<li>`を使っているかを確認し、同じセマンティクスに揃える。
**該当箇所（例）**: `src/components/counterparty-management/CounterpartyManagementScreen.css`(`.counterparty-pattern-row input`、コミットea924c0)、`src/components/counterparty-management/CounterpartyManagementScreen.tsx`(パターン一覧の`<div>`→`<ul>`/`<li>`、同コミット)、Issue #85 実装Attempt 1へのレビュー指摘(コミットea924c0で修正)

## 非同期処理をPromise.resolve(fn())で開始すると、fnが同期的に投げる例外が.catch()で捕捉できない

**症状**: `HouseholdMemberManagementScreen`(および同型実装の`CounterpartyManagementScreen`)の各操作関数(作成・更新・削除・非アクティブ化等)が、`Promise.resolve(repositoryMethod(...)).then(...).catch(...)`という形でRepository呼び出しをPromiseチェーンに乗せていた。`repositoryMethod`(sql.js実装のRepositoryメソッド)がDDLトリガー・CHECK制約違反等で同期的に例外をthrowする場合、その例外は`.catch()`に一切届かず、`Promise.resolve(...)`という式自体の評価中に通常のJS例外としてそのままスローされる。イベントハンドラ内での未処理例外になるため、意図したエラーメッセージ(`setError(...)`)がUIに反映されないままになる。グループ所属メンバー管理のテスト(is_group変更禁止・グループのネスト禁止トリガーのエラー表示を検証するテスト)を書く過程で自己発見した(evaluator指摘ではない)。
**原因**: JavaScriptでは、ある関数呼び出しの引数として渡す別の関数呼び出しは、外側の関数(ここでは`Promise.resolve`)自体が呼ばれるより先に評価される。つまり`Promise.resolve(fn())`は`const result = fn(); Promise.resolve(result)`と等価であり、`fn()`が同期的にthrowした場合`Promise.resolve`が呼ばれることすらなく、その場でJSの同期例外として伝播する。`.catch()`はPromiseチェーンに繋がれたハンドラであり、Promiseそのものが一度も生成されない(式の評価自体が例外で中断する)以上呼び出されようがない。sql.jsのRepositoryメソッドは全て同期API(`db.run`/`db.exec`を直接呼ぶ)であり、DDL制約(CHECK/TRIGGER)違反時は同期的にthrowする設計(`docs/architecture.md` 5.1節)であるため、Repository呼び出しをPromiseチェーンでラップするUIコードはこの罠に特に踏み込みやすい。
**対策**: Repositoryメソッド呼び出しをPromiseチェーンでラップする際は、`Promise.resolve(fn())`ではなく`Promise.resolve().then(() => fn())`の形を使う。`.then()`コールバック内でのthrowは、コールバック自体がマイクロタスクとして非同期に実行されるため、必ずそのPromiseチェーンのrejectionとして扱われる。この書き方であれば、`fn`が同期的に例外を投げる場合(sql.jsの制約違反等)・非同期(Promiseを返しrejectする)場合のいずれであっても`.catch()`で一律に捕捉できる。実装時は、対象のRepositoryメソッドが同期的に例外を投げるケース(DDLトリガー・CHECK制約違反等)をテストで再現し、`.catch()`のエラーハンドラ(UIのエラー表示)が実際に呼ばれることを確認する(正常系のテスト、または非同期に失敗するモックを使うテストだけでは、この罠は再現・検出できない)。
**該当箇所（例）**: `src/components/household-member-management/HouseholdMemberManagementScreen.tsx`(全操作関数、コミットef2f502で`Promise.resolve().then(() => ...)`へ修正)、`src/components/household-member-management/HouseholdMemberManagementScreen.group.test.tsx`(is_group変更禁止トリガーのエラー表示を検証する回帰テスト)、`docs/decisions.md`「非同期の書き込み操作は必ずPromise.resolve().then(() => fn())で開始し、Promise.resolve(fn())は使わない」、Issue #37(実装中に自己発見)。同型のパターン(未修正)が`src/components/counterparty-management/CounterpartyManagementScreen.tsx`(Issue #38)にも残っている。
- 再発例: `src/components/account-list/AccountListScreen.tsx`の`submitEdit`・`deleteAccount`・`deactivateAccount`(計画Issue #95 Implementation Attempt 1)が、既存の確立済み規約(`docs/decisions.md`に明記済み)にもかかわらず`Promise.resolve(fn())`のまま新規実装され、evaluatorのレビューで同一区分内の重複科目名への変更(UNIQUE制約違反、同期例外)を実機相当のテストで再現されFAIL指摘された(重大度HIGH、`isSubmitting`が解除されずボタンが恒久的に無効化されるフリーズも併発)。Attempt 2で3関数とも`Promise.resolve().then(() => fn())`へ修正し、UNIQUE制約違反を実際に発生させる回帰テストを追加してPASSした。既に文書化済みの規約であっても、新しい管理画面(CRUD操作を持つ一覧・編集画面)を実装するたびに同じ罠を踏む再発が続いている(`CounterpartyManagementScreen`に続き3例目)ため、新規の管理画面を実装する計画時点で本パターンの存在を明示的に確認する運用を徹底する必要がある。

## 新しいライフサイクル操作(非アクティブ化)を実装して初めて、既存の複数画面の選択欄フィルタ漏れが顕在化する

**症状**: プロジェクト管理画面(計画Issue #36)でプロジェクトの非アクティブ化(`is_active = false`)操作を初めて実装したところ、それ以前から存在していた`JournalEntryForm`(計画Issue #32)・`StatementImportReviewScreen`(計画Issue #77)のプロジェクト選択`<select>`が、`docs/domain/projects.md` 1.3節「非アクティブ化: 新規仕訳では選択不可」という既に明記済みの制約に反し、`isActive`によるフィルタを行わずマスタの全件をそのまま選択肢に表示していたことが判明した。非アクティブ化操作自体が存在しなかった間は全プロジェクトが常にアクティブだったため、この不具合はそれまで一度も顕在化していなかった。
**原因**: 制約(`docs/domain/projects.md` 1.3節)を計画時点で明記していても、その制約を満たすべき既存の消費側UI(他Issueで実装済みの選択欄)がその制約を実際に破っているかどうかは、制約を発生させる操作(非アクティブ化)自体が実装されるまでテストで検出できない(非アクティブなレコードが1件も存在しないため)。制約を定義・実装するIssue(本件)と、その制約を守るべき既存の消費側画面が別のIssueに分かれていたため、消費側の実装漏れが後から一括で顕在化した。
**対策**: マスタエンティティに`is_active`等のライフサイクルフラグを持たせる場合、そのフラグをtrue以外へ変更する操作(非アクティブ化・アーカイブ等)を実装するIssueでは、「対象エンティティを選択肢に使っている既存画面をリポジトリ全体でgrepし、フィルタ漏れがないか横断的に確認する」ことを完了条件に含める。フィルタは`entity.isActive`のみで絞り込むのではなく`entity.isActive || entity.id === 現在選択中の値`という形にし、既存レコードが既に非アクティブな値を参照している場合に選択値が消えてしまわないよう配慮する(`docs/decisions.md`「非アクティブ化可能なマスタの選択欄は、is_activeだけでなく現在選択中の値も含めてフィルタする」参照)。
**該当箇所（例）**: `src/components/journal-entry/JournalEntryForm.tsx`・`src/components/statement-import/StatementImportReviewScreen.tsx`(いずれもコミット88190fdで修正)、`docs/domain/projects.md` 1.3節、計画Issue #36実装中に自己発見

## コンポーネントファイルとヘルパー関数ファイルの名前を先頭1文字の大文字小文字違いだけで区別すると、Windows等の大文字小文字を区別しないファイルシステム上でViteが誤ったファイルをimportする

**症状**: 新設するヘルパー関数ファイル(判定関数等)を、同じディレクトリに既にあるコンポーネントファイルと先頭1文字の大文字小文字だけが異なる名前(例: 判定関数`householdMemberSelectionStep.ts`とコンポーネント`HouseholdMemberSelectionStep.tsx`)で作成すると、Windows(NTFS)のような大文字小文字を区別しない(case-insensitive)ファイルシステム上で、拡張子省略のimport指定(`./householdMemberSelectionStep`)に対するViteのモジュール解決が、拡張子候補を順に試す過程で意図したファイルではなく大文字小文字違いのコンポーネントファイルの方へ解決してしまう。結果、意図した関数(boolean判定関数)ではなく別のモジュール(Reactコンポーネント)がimportされ、型エラーまたは実行時エラーになる。計画Issue #92の実装中に発覚し、ヘルパー関数ファイルを`shouldShowHouseholdMemberSelectionStep.ts`(先頭を動詞句にし、コンポーネント名とベース名自体が異なる命名)へリネームして回避した。
**原因**: NTFS等は大文字小文字を区別せずパス解決するため、bundlerのファイル存在確認も大文字小文字を無視して一致する。両ファイルは拡張子(`.ts`/`.tsx`)や役割が異なるため命名時は「別ファイル」のつもりになりやすいが、拡張子省略のimport文字列(モジュール指定子)自体はコンポーネントファイル名と大文字小文字違いの同一文字列であるため、拡張子解決の試行順によっては意図しないファイルへ解決されうる。この問題はmacOS(既定のAPFSも大文字小文字を区別しないモードが多い)でも起こりうるが、Linux(区別する)では再現しないため、開発環境によって顕在化しないことがある(本リポジトリの開発環境はWindows)。
**対策**: 同一ディレクトリにコンポーネントとヘルパー関数のように役割の異なる複数ファイルを追加する際は、ファイル名を大文字小文字の違いだけで区別せず、ベース名自体を明確に分ける(判定関数には`shouldShowXxx`のような動詞句を先頭に付ける等)。実装中に想定と異なるモジュールがimportされている疑いがある場合(型不一致・想定しないプロパティへのアクセスエラー等)は、拡張子を明示したimportで実際の解決先を確認する。Windows/macOS環境で開発する際は特にこの制約を意識し、新規ファイル作成時に既存ファイル名との大文字小文字のみの差分がないか確認する。
**該当箇所（例）**: `src/components/account-registration/HouseholdMemberSelectionStep.tsx`(コンポーネント)、`src/components/account-registration/shouldShowHouseholdMemberSelectionStep.ts`(判定関数、命名変更後)、計画Issue #92実装中に自己発見(コミット81b479c時点で既にリネーム済み)

## Worker起動時の新しい冪等シード関数を追加すると、DBの初期状態を前提にしていた既存のE2Eテストが連鎖的に壊れる

**症状**: 計画Issue #96で`seedDefaultAccounts`(revenue・expense区分の科目が0件ならWorker起動時に標準科目一式を自動投入)を追加したところ、それまで「Worker起動直後は科目が0件」を前提にしていたE2Eテスト(`account-list.spec.ts`の「登録済み科目が0件の場合は空状態が表示される」等)や、テスト内で標準科目と同名(「食費」等)の科目をテスト用データとして作成していたE2Eテスト(`worker-rpc.spec.ts`等)が、標準科目の投入によって前提が崩れたり名前が衝突したりして失敗するようになった。影響はe2e配下9ファイルに及んだ。
**原因**: Worker起動時に無条件で実行される新しい冪等シード関数は、既存のE2Eテスト全体にとって「DBの初期状態」そのものを変更する横断的な変更である。しかし変更対象のファイル(新規のseed関数・db.worker.ts)を見ただけでは、DBの初期状態に依存している既存テストがリポジトリ全体のどこに散らばっているか分からず、実装時に見落としやすい。`seedDefaultHouseholdMember`(計画Issue #88)・`seedBuiltInMappingDefinitions`(計画Issue #76)という過去2件の同種のシード追加でも、程度の差はあれ同じ影響が既存テストに及んでいた可能性がある。
**対策**: Worker起動時に無条件実行される新しい冪等シード関数を追加する際は、実装直後に`e2e/`配下を「DBが空/特定件数であることを前提にした検証」「シードする科目・メンバー名と同名の文字列を使うテストデータ」の観点で横断的にgrepし、影響を受けるテストを洗い出してから同時に修正する。0件前提のテストは「投入されないはずの状態」を検証するテストへ置き換えるのではなく、新しいシード内容そのものが正しく投入されていることを検証するテストへ書き換える(本件では「科目が0件」のテストを「標準科目が一覧に表示される」テストへ変更)。テストデータの科目名は、新設するシードの標準名リスト(本件の`defaultAccountSeedData.ts`)と衝突しない名前(「テスト費目」等)を使う。
**該当箇所（例）**: `src/infrastructure/db/seedDefaultAccounts.ts`・`defaultAccountSeedData.ts`、`e2e/account-list.spec.ts`・`e2e/worker-rpc.spec.ts`ほか計9ファイル(コミット83bdd8a)、`docs/decisions.md`「標準的な収益・費用の勘定科目の自動投入(seedDefaultAccounts)は...」、計画Issue #96実装中に自己発見
