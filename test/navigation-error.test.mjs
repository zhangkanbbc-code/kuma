import assert from 'node:assert/strict'
import test from 'node:test'
import navigationError from '../dist/shared/navigation-error.js'

const { isNavigationAborted } = navigationError

for (const [shape, error] of [
  ['code', { code: 'ERR_ABORTED' }],
  ['errno', { errno: -3 }],
  ['message', new Error("ERR_ABORTED (-3) loading 'https://example.test/login'")],
]) {
  test(`导航中断识别单独的 ${shape}`, () => {
    assert.equal(isNavigationAborted(error), true)
  })
}

test('非导航中断错误不会被当成成功', () => {
  for (const error of [
    { code: 'ERR_NAME_NOT_RESOLVED', errno: -105 },
    new Error('ERR_CONNECTION_REFUSED (-102)'),
    { code: 'ERR_ABORTED_OTHER' }, { errno: '-3' },
    new Error('ERR_ABORTED (-30)'), {}, null, undefined,
  ]) {
    assert.equal(isNavigationAborted(error), false)
  }
})
