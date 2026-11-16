// Sample lesson, simplified from pakiety/lekcja-ui/src/content/schema.ts (lekcja.tresc.json).
// Only the parts the runtime needs: modules, lesson steps and SRS positions (cards + quiz with cid).

export type Position = { cid: string; typ: 'card' | 'quiz'; mod: string; q: string; a: string; src: string[] }
export type Module = { id: string; title: string; steps: number; positions: Position[] }
export type Lesson = { slug: string; dziedzina: string; title: string; modules: Module[] }

export const SAMPLE_LESSON: Lesson = {
  slug: 'kardio-demo',
  dziedzina: 'kardiologia',
  title: 'Rytm i ciśnienie (lekcja przykładowa)',
  modules: [
    {
      id: 'm1',
      title: 'Rytm serca',
      steps: 2,
      positions: [
        { cid: 'c1', typ: 'card', mod: 'm1', q: 'Rozrusznik fizjologiczny serca?', a: 'Węzeł zatokowo-przedsionkowy', src: ['robbins-2026#p410'] },
        { cid: 'c2', typ: 'card', mod: 'm1', q: 'Opóźnienie przewodzenia przedsionki→komory?', a: 'Węzeł przedsionkowo-komorowy', src: ['robbins-2026#p411'] },
        { cid: 'q1', typ: 'quiz', mod: 'm1', q: 'Co odpowiada załamkowi P?', a: 'Depolaryzacja przedsionków', src: ['robbins-2026#p411'] },
      ],
    },
    {
      id: 'm2',
      title: 'Ciśnienie tętnicze',
      steps: 1,
      positions: [
        { cid: 'c3', typ: 'card', mod: 'm2', q: 'Główny regulator krótkoterminowy RR?', a: 'Odruch z baroreceptorów', src: ['robbins-2026#p412'] },
        { cid: 'q2', typ: 'quiz', mod: 'm2', q: 'Enzym przekształcający angiotensynę I?', a: 'ACE', src: ['robbins-2026#p413'] },
      ],
    },
  ],
}

export const ALL_POSITIONS = SAMPLE_LESSON.modules.flatMap((m) => m.positions)
