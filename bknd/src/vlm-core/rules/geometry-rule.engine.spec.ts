import {
  createCorrectComparisonFixture,
  createElbowErrorFixture,
  createLowVisibilityFixture,
  createWrongHandShapeFixture,
} from '../fixtures/comparison.fixtures';
import { GeometryRuleEngine } from './geometry-rule.engine';

describe('GeometryRuleEngine', () => {
  const engine = new GeometryRuleEngine();

  it('accepts a comparison without measurements outside tolerance', () => {
    const result = engine.evaluate(createCorrectComparisonFixture());

    expect(result.abstained).toBe(false);
    expect(result.candidates).toHaveLength(0);
  });

  it('creates a high-confidence elbow correction candidate', () => {
    const result = engine.evaluate(createElbowErrorFixture());

    expect(result.abstained).toBe(false);
    expect(result.candidates[0]).toMatchObject({
      issueCode: 'ELBOW_TOO_STRAIGHT',
      bodyPart: 'right_elbow',
      autoPauseEligible: true,
    });
  });

  it('detects a categorical hand-shape mismatch', () => {
    const result = engine.evaluate(createWrongHandShapeFixture());

    expect(result.candidates[0]).toMatchObject({
      issueCode: 'WRONG_HAND_SHAPE',
      bodyPart: 'right_hand',
      autoPauseEligible: true,
    });
  });

  it('abstains when body visibility is insufficient', () => {
    const result = engine.evaluate(createLowVisibilityFixture());

    expect(result).toMatchObject({
      abstained: true,
      abstainReason: 'INSUFFICIENT_VISIBILITY',
      candidates: [],
    });
  });
});
