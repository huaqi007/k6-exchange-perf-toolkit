/** k6/metrics 的测试 stub —— 记录 add() 调用，供断言使用。 */
class MetricStub {
  public values: number[] = []
  constructor(public readonly name: string) {}
  add(value: number): void {
    this.values.push(value)
  }
  reset(): void {
    this.values = []
  }
}

export class Counter extends MetricStub {}
export class Trend extends MetricStub {}
export class Rate extends MetricStub {}
export class Gauge extends MetricStub {}

export default { Counter, Trend, Rate, Gauge }
