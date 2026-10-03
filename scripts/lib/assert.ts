export interface Reporter {
  pass: number;
  fail: number;
  assert(cond: boolean, msg: string): void;
}

export function createReporter(): Reporter {
  const r: Reporter = {
    pass: 0,
    fail: 0,
    assert(cond, msg) {
      if (cond) {
        r.pass++;
        console.log("PASS:", msg);
      } else {
        r.fail++;
        console.log("FAIL:", msg);
      }
    },
  };
  return r;
}
