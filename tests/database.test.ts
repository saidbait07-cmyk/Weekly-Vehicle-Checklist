import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
const admin = "00000000-0000-4000-8000-000000000001",
  sup = "00000000-0000-4000-8000-000000000002",
  driver = "00000000-0000-4000-8000-000000000003",
  other = "00000000-0000-4000-8000-000000000004",
  outsider = "00000000-0000-4000-8000-000000000005";
test("PostgreSQL migrations, RLS and transactional inspection workflow", async (t) => {
  const pg = new PGlite();
  await pg.waitReady;
  // Minimal Supabase platform fixtures, NOT substitutes for live Auth/Storage integration.
  await pg.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,storage,public to anon,authenticated,service_role;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;`,
  );
  for (const file of readdirSync("supabase/migrations").sort())
    await pg.exec(readFileSync("supabase/migrations/" + file, "utf8"));
  await pg.exec(
    `insert into auth.users values('${admin}'),('${sup}'),('${driver}'),('${other}'),('${outsider}');insert into public.profiles(id,employee_id,full_name,email,role)values('${admin}','FG-1001','Test Admin','admin@example.test','administrator'),('${sup}','FG-1002','Test Supervisor','supervisor@example.test','supervisor'),('${driver}','FG-1003','Test Driver','driver@example.test','driver'),('${other}','FG-1004','Other Driver','other@example.test','driver'),('${outsider}','FG-1005','Other Supervisor','outsider@example.test','supervisor');update public.profiles set supervisor_id='${sup}' where id='${driver}';`,
  );
  const as = async (id: string, role = "authenticated") => {
    await pg.exec(
      `reset role;set role ${role};select set_config('request.jwt.claim.sub','${id}',false);`,
    );
  };
  const scalar = async (sql: string, params: any[] = []) => {
    const r = await pg.query<Record<string, any>>(sql, params);
    return Object.values(r.rows[0])[0];
  };
  let vehicle: string, second: string, inspection: string;
  await t.test("anonymous access denied", async () => {
    await as("", "anon");
    await assert.rejects(pg.query("select * from public.profiles"));
    await assert.rejects(
      pg.query(
        "select public.start_inspection(gen_random_uuid(),gen_random_uuid())",
      ),
    );
  });
  await t.test(
    "admin manages vehicles and assignments; duplicates rejected",
    async () => {
      await as(admin);
      vehicle = await scalar(
        "select public.save_vehicle(null,'TEST-001','Test truck','heavy','Test site',true)",
      );
      second = await scalar(
        "select public.save_vehicle(null,'TEST-002','Other truck','light','Test site',true)",
      );
      await pg.query(
        "select public.assign_vehicle($1,$2,(now() at time zone 'Asia/Muscat')::date)",
        [vehicle, driver],
      );
      await assert.rejects(
        pg.query(
          "select public.assign_vehicle($1,$2,(now() at time zone 'Asia/Muscat')::date)",
          [vehicle, other],
        ),
      );
      await pg.query(
        "select public.assign_vehicle($1,$2,(now() at time zone 'Asia/Muscat')::date)",
        [second, other],
      );
    },
  );
  await t.test(
    "driver cannot access other employee or vehicle, escalate, create vehicle",
    async () => {
      await as(driver);
      assert.equal(await scalar("select count(*) from public.vehicles"), 1);
      assert.equal(await scalar("select count(*) from public.profiles"), 1);
      await assert.rejects(
        pg.query(
          "update public.profiles set role='administrator' where id=$1",
          [driver],
        ),
      );
      await assert.rejects(
        pg.query(
          "select public.save_vehicle(null,'BAD','bad','light','',true)",
        ),
      );
      await assert.rejects(
        pg.query("select public.start_inspection($1,gen_random_uuid())", [
          second,
        ]),
      );
      inspection = await scalar(
        "select public.start_inspection($1,gen_random_uuid())",
        [vehicle],
      );
      assert.equal(
        await scalar("select public.start_inspection($1,gen_random_uuid())", [
          vehicle,
        ]),
        inspection,
      );
    },
  );
  const answers = Array.from({ length: 27 }, (_, i) => ({
    item_no: i + 1,
    result: i === 0 ? "fail" : "pass",
    comment: i === 0 ? "Test mirror defect" : "",
    photos: [] as string[],
  }));
  const submit = (a: any[]) =>
    pg.query(
      "select public.submit_inspection($1,$2::jsonb,100,110,'Test Driver',(now() at time zone 'Asia/Muscat')::date+365,'Test note')",
      [inspection, JSON.stringify(a)],
    );
  await t.test(
    "incomplete/duplicate checks, failure without comment, invalid photo rollback",
    async () => {
      await assert.rejects(submit(answers.slice(0, 26)));
      await assert.rejects(
        submit(answers.map((a, i) => (i === 1 ? { ...a, item_no: 1 } : a))),
      );
      await assert.rejects(submit(answers.map((a) => ({ ...a, comment: "" }))));
      await assert.rejects(
        submit(
          answers.map((a, i) =>
            i === 0 ? { ...a, photos: ["somebody/else/file.jpg"] } : a,
          ),
        ),
      );
      assert.equal(
        await scalar("select count(*) from public.inspection_answers"),
        0,
      );
    },
  );
  const photo = `${driver}/${inspection!}/1-test.jpg`;
  await t.test(
    "private storage policy rejects cross-owner photo uploads",
    async () => {
      await assert.rejects(
        pg.query(
          "insert into storage.objects(bucket_id,name)values('inspection-photos',$1)",
          [`${other}/${inspection}/x.jpg`],
        ),
      );
      await pg.query(
        "insert into storage.objects(bucket_id,name)values('inspection-photos',$1)",
        [photo],
      );
      answers[0].photos = [photo];
    },
  );
  await t.test(
    "submission persists all answers, creates defect and is idempotent",
    async () => {
      await submit(answers);
      assert.equal(
        await scalar("select count(*) from public.inspection_answers"),
        27,
      );
      assert.equal(
        await scalar("select count(*) from public.vehicle_defects"),
        1,
      );
      assert.equal(
        await scalar("select status from public.inspections where id=$1", [
          inspection,
        ]),
        "submitted",
      );
      await submit(answers);
      assert.equal(
        await scalar("select count(*) from public.inspection_answers"),
        27,
      );
      await assert.rejects(
        pg.query(
          "update public.inspections set status='approved' where id=$1",
          [inspection],
        ),
      );
      assert.equal(
        await scalar("select public.can_upload($1)", [photo]),
        false,
      );
      const removed = await pg.query(
        "delete from storage.objects where name=$1 returning id",
        [photo],
      );
      assert.equal(removed.rows.length, 0);
    },
  );
  await t.test(
    "unrelated driver and supervisor cannot view or approve submitted report",
    async () => {
      for (const id of [other, outsider]) {
        await as(id);
        assert.equal(
          await scalar("select count(*) from public.inspections"),
          0,
        );
        assert.equal(await scalar("select count(*) from storage.objects"), 0);
        await assert.rejects(
          pg.query(
            "select public.review_inspection($1,'approved','Reviewed','Test Reviewer')",
            [inspection],
          ),
        );
      }
    },
  );
  await t.test(
    "assigned supervisor sees evidence, reviews and records corrective action",
    async () => {
      await as(sup);
      assert.equal(await scalar("select count(*) from public.inspections"), 1);
      assert.equal(await scalar("select count(*) from storage.objects"), 1);
      await pg.query(
        "select public.review_inspection($1,'approved','Reviewed test report','Test Supervisor')",
        [inspection],
      );
      assert.equal(
        await scalar("select status from public.inspections"),
        "approved",
      );
      assert.equal(
        await scalar("select count(*) from public.supervisor_approvals"),
        1,
      );
      await assert.rejects(
        pg.query(
          "select public.review_inspection($1,'rejected','Again','Test Supervisor')",
          [inspection],
        ),
      );
      const defect = await scalar("select id from public.vehicle_defects");
      await pg.query(
        "select public.update_defect($1,'resolved','Replaced mirror',$2)",
        [defect, driver],
      );
      assert.equal(
        await scalar("select status from public.vehicle_defects"),
        "resolved",
      );
    },
  );
  await t.test(
    "permission changes enforced by database, not only UI",
    async () => {
      await as(admin);
      await pg.query(
        "select public.set_permission('supervisor','manage_defects',false)",
      );
      await as(sup);
      await assert.rejects(
        pg.query(
          "select public.update_defect((select id from public.vehicle_defects),'open','Try again',null)",
        ),
      );
    },
  );
  await t.test(
    "deactivation revokes existing session access immediately",
    async () => {
      await pg.exec("reset role");
      await pg.query("update public.profiles set active=false where id=$1", [
        driver,
      ]);
      await as(driver);
      assert.equal(await scalar("select count(*) from public.inspections"), 0);
      assert.equal(await scalar("select count(*) from public.vehicles"), 0);
      assert.equal(await scalar("select count(*) from storage.objects"), 0);
      await assert.rejects(pg.query("select public.set_language('ar')"));
    },
  );
  await t.test("last administrator guard and audit integrity", async () => {
    await pg.exec("reset role");
    await assert.rejects(
      pg.query("update public.profiles set active=false where id=$1", [admin]),
    );
    await as(sup);
    await assert.rejects(pg.query("delete from public.audit_logs"));
    await as(admin);
    assert((await scalar("select count(*) from public.audit_logs")) > 10);
    const stats = await scalar("select public.dashboard_stats()");
    assert.equal(stats.today, 1);
    assert.equal(stats.maintenance, 0);
    assert.equal(stats.trend.length, 7);
  });
  await t.test('template versions preserve historical labels and source field kinds', async () => {
    await as(admin);
    const oldTemplate = await scalar('select id from public.inspection_templates where version=1');
    const source = await scalar('select items from public.inspection_templates where version=1');
    const changed = structuredClone(source); changed[0].label_en = 'Updated light inspection label';
    await pg.query('select public.publish_template($1,$2::jsonb)', ['Version two', JSON.stringify(changed)]);
    assert.equal(await scalar('select template_id from public.inspections where id=$1',[inspection]), oldTemplate);
    assert.equal(await scalar("select items->0->>'label_en' from public.inspection_templates where version=1"), 'Light & Indicator');
    assert.equal(await scalar('select count(*) from public.inspection_templates where active'),1);
    changed[27].kind='check';
    await assert.rejects(pg.query('select public.publish_template($1,$2::jsonb)', ['Invalid',JSON.stringify(changed)]));
  });
  await t.test('rate limiting is atomic and service-only; unsupported languages rejected', async () => {
    await as(admin);
    await assert.rejects(pg.query("select public.consume_rate_limit('test',1,60)"));
    await assert.rejects(pg.query("select public.next_employee_id()"));
    await assert.rejects(pg.query("select public.set_language('fr')"));
    await pg.exec('reset role');
    assert.equal(await scalar("select public.consume_rate_limit('test',1,60)"),true);
    assert.equal(await scalar("select public.consume_rate_limit('test',1,60)"),false);
  });
  await pg.close();
});
