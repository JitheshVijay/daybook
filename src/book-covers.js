import { bookKey, personKey } from "./domain.js";
export const BOOK_COVER_VERSION = 2;
export async function fillBookCovers(commit, books, fetchImpl = fetch) {
  for (let index = 0; index < books.length; index++) {
    const book = books[index];
    if (book.cover) continue;
    try {
      if (index) await new Promise((resolve) => setTimeout(resolve, 1100));
      const params = new URLSearchParams({
        title: book.title,
        limit: "5",
        fields: "title,author_name,cover_i",
        ...(book.author ? { author: book.author } : {}),
      });
      const response = await fetchImpl(
        `https://openlibrary.org/search.json?${params}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!response.ok) continue;
      const data = await response.json();
      // Open Library ranks the best-known edition first.
      const match = data.docs?.find(
        (x) =>
          bookKey(x.title) === bookKey(book.title) &&
          Number.isInteger(x.cover_i) &&
          x.cover_i > 0 &&
          (!book.author ||
            x.author_name?.some((a) => {
              const found = personKey(a);
              const wanted = personKey(book.author);
              return found === wanted || found.includes(wanted) || wanted.includes(found);
            })),
      );
      if (!match) continue;
      commit((state) => ({
        ...state,
        books: state.books.map((current) =>
          current.id === book.id &&
          !current.cover &&
          current.title === book.title &&
          current.author === book.author
            ? {
                ...current,
                cover: `https://covers.openlibrary.org/b/id/${match.cover_i}-M.jpg?default=false`,
                author: current.author || match.author_name?.[0] || "",
              }
            : current,
        ),
      }));
    } catch {
      /* Cover lookup is optional; saved activity records are unaffected. */
    }
  }
}
