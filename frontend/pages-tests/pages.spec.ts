import { test, expect, type Page } from "@playwright/test";
import { readdirSync } from "node:fs";
const chunk =
  "/Flashcard/assets/" +
  readdirSync("dist/assets").find((f) => /^browserStore-.*\.js$/.test(f));
async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body, chunk }) => {
      const module = await import(chunk);
      const fn = Object.values(module).find(
        (v) => typeof v === "function",
      ) as Function;
      return fn(path, method, body);
    },
    { path, method, body, chunk },
  );
}
test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "오늘도, 한 단어씩." }),
  ).toBeVisible();
});

test("GitHub 하위 경로에서 서버 없이 등록·학습·저장·복원", async ({ page }) => {
  const network: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) network.push(r.url());
  });
  await page.goto("#/notebooks");
  await page.getByRole("button", { name: "새 단어장", exact: true }).click();
  await page
    .getByRole("textbox", { name: "단어장 이름", exact: true })
    .fill("브라우저 영어");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "브라우저 영어" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "단어 등록", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "여러 단어", exact: true }).click();
  await page
    .getByLabel("영어 단어[TAB]뜻")
    .fill("apple\t사과\nbank\t은행, 금융기관\nbank\t강둑");
  await page.getByRole("button", { name: "한꺼번에 등록" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".word-row")).toHaveCount(3);
  await page.getByRole("button", { name: "학습하기", exact: true }).click();
  await page.getByRole("button", { name: "학습 시작" }).click();
  await page.getByRole("button", { name: "중요", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "중요", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "잊음", exact: true }).click();
  await page.getByRole("button", { name: "다음 카드", exact: true }).click();
  await page.getByRole("button", { name: "뜻 보기", exact: true }).click();
  await expect(page.locator(".flashcard")).toHaveClass(/flipped/);
  const before = await api(
    page,
    "/study/" + (await page.evaluate(() => location.hash.split("/").pop())),
  );
  await page.reload();
  await expect(page.locator(".flashcard")).toHaveClass(/flipped/);
  const restored = await api(page, "/study/" + before.id);
  expect(restored.position).toBe(1);
  expect(restored.cards.map((c: any) => c.id)).toEqual(
    before.cards.map((c: any) => c.id),
  );
  await page.goto("#/saved");
  await expect(page.locator(".word-row")).toHaveCount(1);
  expect(network).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("브라우저 시험·채점·오답·중복 제출과 재시작 복원", async ({ page }) => {
  const b = await api(page, "/notebooks", "POST", { name: "시험 단어장" });
  await api(page, `/notebooks/${b.id}/cards`, "POST", {
    cards: [
      {
        word: "Ice Cream",
        definition: "차가운 디저트",
        accepted_answers: ["gelato"],
      },
      { word: "hello", definition: "인사" },
    ],
  });
  const exam = await api(page, "/exams", "POST", {
    source: { kind: "notebook", notebook_id: b.id },
    count: "20",
  });
  expect(JSON.stringify(exam)).not.toContain("Ice Cream");
  expect(JSON.stringify(exam)).not.toContain("gelato");
  await page.goto(`#/exams/${exam.id}`);
  for (let i = 0; i < exam.questions.length; i++) {
    await page
      .getByRole("button", { name: `${i + 1}번 문항`, exact: true })
      .click();
    await page
      .getByLabel("영어 정답")
      .fill(
        exam.questions[i].definition === "인사" ? "wrong" : "  iCE   cREAM  ",
      );
  }
  await expect(page.getByText("이 브라우저에 저장됨")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("영어 정답")).toHaveValue(
    exam.questions[1].definition === "인사" ? "wrong" : "  iCE   cREAM  ",
  );
  await page.getByRole("button", { name: "답안 제출" }).click();
  await expect(page.locator(".score-circle")).toContainText("50");
  const result = await api(page, `/exams/${exam.id}`);
  expect(
    await api(page, `/exams/${exam.id}/submit`, "POST", { answers: {} }),
  ).toEqual(result);
  expect((await api(page, "/dashboard")).completed_exams).toBe(1);
  await page.getByRole("button", { name: "오답을 잊음으로 저장" }).click();
  expect((await api(page, "/saved")).length).toBe(1);
  await page.getByRole("button", { name: "오답만 재시험" }).click();
  await expect(page.locator(".question-card h2")).toHaveText("인사");
  await page.getByLabel("영어 정답").fill(" HELLO ");
  await page.getByRole("button", { name: "답안 제출" }).click();
  await expect(page.locator(".score-circle")).toContainText("100");
  await page.reload();
  await expect(page.locator(".score-circle")).toContainText("100");
});

test("여러 탭의 저장 충돌 방지, 삭제 규칙과 빈 출처", async ({
  page,
  context,
}) => {
  const b = await api(page, "/notebooks", "POST", { name: "보존 검증" });
  let failed = false;
  try {
    await api(page, "/study", "POST", {
      source: { kind: "notebook", notebook_id: b.id },
      count: "10",
    });
  } catch {
    failed = true;
  }
  expect(failed).toBe(true);
  const second = await context.newPage();
  await second.goto("./");
  await expect(
    second.getByRole("heading", { name: "오늘도, 한 단어씩." }),
  ).toBeVisible();
  await Promise.all([
    api(page, `/notebooks/${b.id}/cards`, "POST", {
      cards: [{ word: "one", definition: "하나" }],
    }),
    api(second, `/notebooks/${b.id}/cards`, "POST", {
      cards: [{ word: "two", definition: "둘" }],
    }),
  ]);
  const book = await api(page, `/notebooks/${b.id}`);
  expect(book.card_count).toBe(2);
  const c = book.cards[0];
  await api(page, `/cards/${c.id}/saved`, "PUT", {
    important: true,
    forgotten: true,
  });
  await api(page, `/cards/${c.id}/saved`, "PUT", {
    important: true,
    forgotten: true,
  });
  await api(page, `/notebooks/${b.id}`, "DELETE");
  expect((await api(second, "/saved")).length).toBe(1);
  await api(second, `/cards/${c.id}`, "DELETE");
  expect((await api(page, "/saved")).length).toBe(0);
  await page.goto("#/levels");
  await expect(page.locator(".word-row")).toHaveCount(200);
  const levels=await api(page,"/levels");
  expect(levels.reduce((n:number,l:any)=>n+l.total,0)).toBe(10000);
  const full=await api(page,"/study","POST",{source:{kind:"level",level:1},count:"all"});
  expect(full.cards.length).toBe(878);
  expect(new Set(full.cards.map((c:any)=>c.word)).size).toBe(878);
  expect(full.cards.every((c:any)=>c.classification_kind==="frequency")).toBe(true);
  const lookup=await api(page,"/dictionary/lookup","POST",{words:["apple"]});
  expect(lookup.results[0].candidates[0].source).toBe("wordnet");
  await expect(
    page.getByRole("button", { name: "자동 수집·난이도 분류" }),
  ).toHaveCount(0);
});

test('기존 개인 자료를 유지하며 사전을 한 번만 추가',async({page})=>{
  await api(page,'/health');
  await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('word-garden',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put({version:1,seq:8,cards:{7:{id:7,word:'myword',definition:'나의 뜻',pos:'',notes:'',accepted_answers:[],important:true,forgotten:false,kind:'personal'}},books:[{id:8,name:'기존 단어장',ids:[7],created_at:'2026-01-01'}],studies:{},exams:{}},'app');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
  });
  await page.reload();await expect(page.getByRole('heading',{name:'오늘도, 한 단어씩.'})).toBeVisible();
  expect((await api(page,'/notebooks/8')).cards[0].word).toBe('myword');
  expect((await api(page,'/saved'))[0].id).toBe(7);
  const levels=await api(page,'/levels');expect(levels.reduce((sum:number,l:any)=>sum+l.total,0)).toBe(10000);
  await page.reload();await expect(page.getByRole('heading',{name:'오늘도, 한 단어씩.'})).toBeVisible();
  expect(await api(page,'/levels')).toEqual(levels);
});
