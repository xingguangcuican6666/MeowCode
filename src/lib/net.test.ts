import { describe, it, expect, afterEach } from 'vitest'
import { isBlockedIp, checkUrl } from './net'

describe('isBlockedIp', () => {
  it('blocks loopback, private, CGNAT and link-local IPv4', () => {
    for (const ip of [
      '127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.254',
      '192.168.1.1', '100.64.0.1', '169.254.169.254', '0.0.0.0', '255.255.255.255',
      '224.0.0.1', '240.0.0.1', '198.18.0.1',
    ]) expect(isBlockedIp(ip), ip).toBe(true)
  })

  it('allows public IPv4', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '100.63.255.255']) {
      expect(isBlockedIp(ip), ip).toBe(false)
    }
  })

  it('blocks IPv6 loopback, unique-local, link-local and multicast', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1', '100::1']) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })

  it('allows public IPv6', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888']) {
      expect(isBlockedIp(ip), ip).toBe(false)
    }
  })

  it('sees through IPv4-mapped and NAT64 wrappers', () => {
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true)
    expect(isBlockedIp('64:ff9b::127.0.0.1')).toBe(true)
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false)
  })

  it('treats unparseable input as unsafe', () => {
    for (const s of ['', 'nonsense', '1.2.3', '1.2.3.4.5', '999.1.1.1', 'gggg::1']) {
      expect(isBlockedIp(s), s).toBe(true)
    }
  })
})

describe('checkUrl', () => {
  afterEach(() => { delete process.env.MEOWCODE_ALLOW_PRIVATE_FETCH })

  it('refuses non-http(s) schemes', async () => {
    expect((await checkUrl('file:///etc/passwd')).ok).toBe(false)
    expect((await checkUrl('ftp://example.com/x')).ok).toBe(false)
  })

  it('refuses embedded credentials', async () => {
    const v = await checkUrl('https://user:pw@example.com/')
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('credentials')
  })

  it('refuses local names and literal private addresses without a lookup', async () => {
    for (const u of [
      'http://localhost:6379/',
      'http://foo.localhost/',
      'http://svc.internal/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://127.0.0.1:8080/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]:9000/',
      'http://10.1.2.3/',
    ]) expect((await checkUrl(u)).ok, u).toBe(false)
  })

  it('allows a public literal address', async () => {
    expect((await checkUrl('https://1.1.1.1/')).ok).toBe(true)
  })

  it('MEOWCODE_ALLOW_PRIVATE_FETCH=1 opts out', async () => {
    process.env.MEOWCODE_ALLOW_PRIVATE_FETCH = '1'
    expect((await checkUrl('http://127.0.0.1:3000/')).ok).toBe(true)
    // …but a bad scheme is still refused.
    expect((await checkUrl('file:///etc/passwd')).ok).toBe(false)
  })

  it('rejects an unresolvable host', async () => {
    const v = await checkUrl('https://this-name-should-not-exist.invalid/')
    expect(v.ok).toBe(false)
  })
})
