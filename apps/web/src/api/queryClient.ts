import { QueryClient } from '@tanstack/react-query'

/** 앱 전역 쿼리 클라이언트.
 *
 *  **`main.tsx` 가 아니라 여기 사는 이유**가 있다. 언어 전환이 서버 문구를 다시 받아오려면
 *  화면 밖(`i18n/switchLocale.ts`)에서도 이 객체를 만져야 하는데, 그것을 `main.tsx` 가
 *  내보내면 `App`·`Login` 이 **앱 시작 파일을 거꾸로 임포트**하게 된다.
 *
 *  그 고리는 브라우저에서는 무해했다(클릭 시점에만 꺼내 쓰므로). 하지만 `App` 을 임포트하는
 *  테스트를 만들자마자 `main.tsx` 가 통째로 실행되고 `#root 엘리먼트를 찾을 수 없습니다` 로
 *  터졌다 — 화면 코드가 아니라 **테스트를 못 쓰게 만드는** 종류의 결합이었다.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})
