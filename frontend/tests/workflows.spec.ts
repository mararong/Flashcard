import { test, expect, type Page } from "@playwright/test";

test("WordNet 자동 수집 진행과 완료 후 레벨 갱신", async ({ page }) => {
  let started = false;
  let polls = 0;
  const card = { id: 999999, word: "apple", definition: "a fruit", pos: "n", notes: "",
    accepted_answers: [], important: false, forgotten: false, kind: "public", classification_kind: "ai_auto" };
  await page.route("**/api/dictionary/collection", async route => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ limit: 10 });
      started = true;
      await route.fulfill({ json: { id: "browser-test", status: "queued" } });
      return;
    }
    if (started) polls++;
    const done = polls > 1;
    await route.fulfill({ json: { model: "test", counts: { words: done ? 10 : 0, senses: done ? 12 : 0, classified: done ? 12 : 0 },
      job: started ? { id: "browser-test", status: done ? "complete" : "running", phase: "난이도 평가",
        requested: 10, collected: 10, evaluated: done ? 12 : 1, total_groups: 12,
        published: done ? 12 : 0, failed: 0, frequency_review: 0, error: null, current_word: "apple/n" } : null } });
  });
  await page.route("**/api/levels/1/cards?category=ai", route => route.fulfill({ json: polls > 1 ? [card] : [] }));
  await page.goto("/#/levels");
  await page.getByRole("button", { name: "AI 분류", exact: true }).click();
  await page.getByRole("button", { name: "자동 수집·난이도 분류", exact: true }).click();
  await expect(page.getByRole("button", { name: "수집·분류 중…", exact: true })).toBeDisabled();
  await expect(page.getByText("수집 완료", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".word-row")).toHaveCount(1);
  await expect(page.locator(".word-row")).toContainText("AI 자동 분류");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function book(
  page: Page,
  words: { word: string; definition: string; accepted_answers?: string[] }[],
) {
  const b = await (
    await page.request.post("/api/notebooks", {
      data: { name: `검증 단어장 ${Date.now()}` },
    })
  ).json();
  await page.request.post(`/api/notebooks/${b.id}/cards`, {
    data: { cards: words },
  });
  return b;
}

test("단어장과 세 가지 등록 방식, 편집·삭제", async ({ page }) => {
  await page.goto("/#/notebooks");
  await page.getByRole("button", { name: "새 단어장", exact: true }).click();
  await page.getByRole("textbox",{name:"단어장 이름",exact:true}).fill("매일의 영어");
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "매일의 영어" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "단어 등록", exact: true })
    .first()
    .click();
  await page.getByLabel("영어 단어", { exact: true }).fill("grow");
  await page.getByLabel("뜻", { exact: true }).fill("자라다, 성장하다");
  await page.getByLabel("품사", { exact: true }).selectOption("v");
  await page.getByRole("button", { name: "카드 등록", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("자라다, 성장하다", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "단어 등록", exact: true }).click();
  await page.getByRole("button", { name: "여러 단어", exact: true }).click();
  await page
    .getByLabel("영어 단어[TAB]뜻")
    .fill("bank\t은행\nbank\t둑, 강둑\nbank\t은행");
  await page.getByRole("button", { name: "한꺼번에 등록" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("2개 등록 · 중복 1개 제외")).toBeVisible();
  await page.getByRole("button", { name: "단어 등록", exact: true }).click();
  await page.getByRole("button", { name: "영어만 입력", exact: true }).click();
  await page.getByLabel("영어 단어 목록").fill("apple\nzzzzcustomword");
  await page.getByRole("button", { name: "뜻 후보 조회" }).click();
  await expect(
    page.getByText("조회 결과가 없어요. 뜻을 직접 입력해 주세요."),
  ).toBeVisible();
  await page.getByLabel("뜻 확인·수정").nth(1).fill("내가 만든 뜻");
  await page.getByRole("button", { name: "선택한 뜻으로 등록" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("내가 만든 뜻", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "grow 수정", exact: true }).click();
  await page.getByLabel("뜻", { exact: true }).fill("성장하다");
  await page.getByLabel("허용 정답").fill("grow up");
  await page.getByRole("button", { name: "수정 저장" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("성장하다", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("단어 검색").fill("강둑");
  await expect(page.getByLabel("단어 검색")).toHaveValue("강둑");
  await expect(page.locator(".word-row")).toHaveCount(1);
  await page.getByLabel("단어 검색").fill("");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "zzzzcustomword 삭제", exact: true })
    .click();
  await expect(page.getByText("내가 만든 뜻", { exact: true })).toHaveCount(0);
  await page.getByLabel("단어장 이름 수정").click();
  await page.getByRole("textbox",{name:"단어장 이름",exact:true}).fill("새로운 단어장");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "새로운 단어장" }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("단어장 삭제", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "내 단어장", exact: true }),
  ).toBeVisible();
});

test("학습 순서·위치 복원과 저장 상태", async ({ page }) => {
  const b = await book(page, [
    { word: "one", definition: "하나" },
    { word: "two", definition: "둘" },
    { word: "three", definition: "셋" },
  ]);
  await page.goto(`/#/notebooks/${b.id}`);
  await page.getByRole("button", { name: "학습하기", exact: true }).click();
  await expect(
    page.getByText("요청한 10개보다 카드가 적어 3개로 시작합니다."),
  ).toBeVisible();
  const creation = page.waitForResponse(
    (r) => r.url().endsWith("/api/study") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "학습 시작" }).click();
  const original = await (await creation).json();
  await page.getByRole("button", { name: "중요", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "중요", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "잊음", exact: true }).click();
  await page.getByRole("button", { name: "다음 카드", exact: true }).click();
  await page.getByRole("button", { name: "뜻 보기", exact: true }).click();
  await expect(page.locator(".flashcard")).toHaveClass(/flipped/);
  await page.reload();
  await expect(page.locator(".flashcard")).toHaveClass(/flipped/);
  const restored = await (
    await page.request.get(`/api/study/${original.id}`)
  ).json();
  expect(restored.position).toBe(1);
  expect(restored.cards.map((c: { id: number }) => c.id)).toEqual(
    original.cards.map((c: { id: number }) => c.id),
  );
  await page.goto("/#/saved");
  await expect(
    page.locator(`[data-card-id="${original.cards[0].id}"] strong`),
  ).toBeVisible();
  const saved = await (await page.request.get("/api/saved")).json();
  expect(
    saved.find((c: { id: number }) => c.id === original.cards[0].id),
  ).toMatchObject({ important: true, forgotten: true });
});

test("시험 답안 복원·서버 채점·오답 재시험과 저장", async ({ page }) => {
  const b = await book(page, [
    { word: "Ice Cream", definition: "차가운 디저트" },
    { word: "hello", definition: "인사 표현" },
  ]);
  await page.goto("/#/exams");
  await page.getByLabel("단어장 선택").selectOption(String(b.id));
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/exams") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "시험 시작" }).click();
  const exam = await (await created).json();
  expect(JSON.stringify(exam)).not.toContain("Ice Cream");
  expect(JSON.stringify(exam)).not.toContain("hello");
  await expect(
    page.getByRole("button", { name: "영어 발음 듣기" }),
  ).toHaveCount(0);
  for (let i = 0; i < exam.questions.length; i++) {
    const q = exam.questions[i];
    await page
      .getByRole("button", { name: `${i + 1}번 문항`, exact: true })
      .click();
    await page
      .getByLabel("영어 정답")
      .fill(q.definition === "차가운 디저트" ? "  iCE   cREAM  " : "wrong");
  }
  await expect(page.getByText("서버에 저장됨")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("영어 정답")).toHaveValue(
    exam.questions[1].definition === "차가운 디저트"
      ? "  iCE   cREAM  "
      : "wrong",
  );
  await page.getByRole("button", { name: "답안 제출" }).click();
  await expect(
    page.getByRole("heading", { name: "배움을 확인했어요." }),
  ).toBeVisible();
  await expect(page.locator(".score-circle")).toContainText("50");
  await page.getByRole("button", { name: "오답을 잊음으로 저장" }).click();
  await expect(
    page.getByText("1개 오답을 잊음으로 저장했습니다."),
  ).toBeVisible();
  await page.getByRole("button", { name: "오답만 재시험" }).click();
  await expect(page.locator(".question-card h2")).toHaveText("인사 표현");
  await expect(page.getByRole("button", { name: "1번 문항" })).toBeVisible();
  await expect(page.getByRole("button", { name: "2번 문항" })).toHaveCount(0);
  await page.getByLabel("영어 정답").fill("HELLO");
  await page.getByRole("button", { name: "답안 제출" }).click();
  await expect(page.locator(".score-circle")).toContainText("100");
  await page.reload();
  await expect(page.locator(".score-circle")).toContainText("100");
});

test("레벨 출처·AI 없는 학습·발음 미지원", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "speechSynthesis", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/#/levels");
  await page
    .getByRole("button", { name: "AI 분류", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "이 조건의 단어가 아직 없어요" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "시연용 수동 분류", exact: true })
    .click();
  await expect(page.locator(".word-row")).toHaveCount(10);
  await page.getByRole("button", { name: "레벨 1 학습", exact: true }).click();
  await page.getByLabel("학습할 카드 수").selectOption("20");
  await page.getByRole("button", { name: "학습 시작" }).click();
  await expect(
    page.getByText("요청한 20개보다 카드가 적어 10개로 학습합니다."),
  ).toBeVisible();
  await page.getByRole("button", { name: "영어 발음 듣기" }).click();
  await expect(
    page.getByText("이 환경에서는 발음을 지원하지 않습니다"),
  ).toBeVisible();
  await page.getByRole("button", { name: "뜻 보기", exact: true }).click();
  await expect(page.locator(".flashcard")).toHaveClass(/flipped/);
  await page.goto("/#/exams");
  await page
    .getByRole("button", { name: "레벨별 공용 단어", exact: true })
    .click();
  await page.getByLabel("레벨", { exact: true }).selectOption("3");
  await page.getByRole("button", { name: "시험 시작" }).click();
  await expect(
    page.getByRole("heading", { name: "어떤 단어일까요?" }),
  ).toBeVisible();
});

test("서버 오류는 한국어로 안내하고 저장 성공을 표시하지 않음", async ({
  page,
}) => {
  const b = await book(page, [{ word: "test", definition: "테스트" }]);
  const session = await (
    await page.request.post("/api/study", {
      data: { source: { kind: "notebook", notebook_id: b.id } },
    })
  ).json();
  await page.goto(`/#/study/${session.id}`);
  await page.route("**/api/cards/*/saved", (r) => r.abort());
  await page.getByRole("button", { name: "중요", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "서버에 연결할 수 없습니다.",
  );
  await expect(
    page.getByRole("button", { name: "중요", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.unroute("**/api/cards/*/saved");
  await page.route("**/api/dashboard", (r) => r.abort());
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "서버에 연결할 수 없습니다.",
  );
});

test("홈과 모바일 화면에서 가로 잘림 없음", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const widths = testInfo.project.name === "mobile" ? [320, 390, 768] : [1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ["", "notebooks", "levels", "saved", "exams"]) {
      await page.goto(`/#/${route}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  }
  await page.goto("/");
  if(testInfo.project.name==='mobile')await page.setViewportSize({width:390,height:844});
  await expect(
    page.getByRole("heading", { name: "오늘도, 한 단어씩." }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("home.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('학습·시험 카드와 버튼이 좁은 화면에서도 잘리지 않음',async({page},testInfo)=>{
 const b=await book(page,[{word:'pneumonoultramicroscopicsilicovolcanoconiosis',definition:'아주 긴 단어도 작은 화면에서 줄바꿈되는지 확인하는 뜻과 추가 설명'}]);
 const study=await (await page.request.post('/api/study',{data:{source:{kind:'notebook',notebook_id:b.id}}})).json();
 const exam=await (await page.request.post('/api/exams',{data:{source:{kind:'notebook',notebook_id:b.id}}})).json();
 for(const width of testInfo.project.name==='mobile'?[320,390]:[1440]){
  await page.setViewportSize({width,height:850});
  await page.request.patch(`/api/study/${study.id}`,{data:{position:0,flipped:false}});
  await page.goto(`/#/study/${study.id}`);
  await expect(page.locator('.flashcard')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const button of await page.locator('.study-controls button').all()){
   const rect=await button.boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.x+rect!.width).toBeLessThanOrEqual(width);
  }
  await page.getByRole('button',{name:'뜻 보기',exact:true}).click();
  await expect(page.locator('.flashcard')).toHaveClass(/flipped/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.goto(`/#/exams/${exam.id}`);
  await expect(page.getByLabel('영어 정답')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});

test('늦게 준비된 영어 음성을 선택하고 연속 재생을 취소함',async({page})=>{
 const b=await book(page,[{word:'hello',definition:'안녕하세요'}]);
 const study=await (await page.request.post('/api/study',{data:{source:{kind:'notebook',notebook_id:b.id}}})).json();
 await page.addInitScript(()=>{
  const state={voices:[] as {lang:string;name:string}[],spoken:[] as {text:string;lang:string}[],cancelled:0};
  (window as unknown as {speechTest:typeof state}).speechTest=state;
  const synth=new EventTarget();
  Object.assign(synth,{getVoices:()=>state.voices,cancel:()=>{state.cancelled++;},speak:(u:SpeechSynthesisUtterance)=>state.spoken.push({text:u.text,lang:u.lang})});
  Object.defineProperty(window,'speechSynthesis',{value:synth,configurable:true});
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class {text:string;constructor(text:string){this.text=text;}},configurable:true});
 });
 await page.goto(`/#/study/${study.id}`);await expect(page.locator('.flashcard')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).speechTest.spoken)).toEqual([]);
 await page.evaluate(()=>{(window as any).speechTest.voices=[{lang:'ko-KR',name:'한국어'},{lang:'en-US',name:'English'}];window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));});
 const before=await page.evaluate(()=>(window as any).speechTest.cancelled);
 await page.getByRole('button',{name:'영어 발음 듣기'}).click();
 await page.getByRole('button',{name:'영어 발음 듣기'}).click();
 expect(await page.evaluate(()=>(window as any).speechTest.spoken)).toEqual([{text:'hello',lang:'en-US'},{text:'hello',lang:'en-US'}]);
 expect(await page.evaluate(()=>(window as any).speechTest.cancelled)).toBe(before+2);
});
