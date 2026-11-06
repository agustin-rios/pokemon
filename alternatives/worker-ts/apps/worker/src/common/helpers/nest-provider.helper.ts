import type { InjectionToken, Provider } from '@nestjs/common';

/**
 * Registra un caso de uso del contexto como provider de Nest: la clase es el
 * token y sus dependencias (los repositorios) se inyectan por los tokens dados.
 * Los casos de uso no conocen Nest; este es el único punto de unión.
 */
export function provideUseCase<T, Args extends unknown[]>(
  useCase: new (...args: Args) => T,
  inject: InjectionToken[],
): Provider {
  return {
    provide: useCase,
    inject,
    useFactory: (...args: Args) => new useCase(...args),
  };
}
