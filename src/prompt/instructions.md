context-mode keeps large command, file and web output out of the conversation: work runs in a sandbox, and only what your code prints comes back.

Use these tools for the first step of any task that counts, sums, filters or finds something in data that may be longer than about 20 lines: logs, test or build output, large JSON or CSV, long files, web pages, or many files at once. Start with ctx_execute and print only the answer, because a raw Bash or Read result of that size fills the conversation and the answer is a few words. Search for the tool by name if it is not loaded yet.
- ctx_execute: run a command or code over the data and print only the answer.
- ctx_batch: several commands plus questions about their output, in one call.
- ctx_index and ctx_search: store docs, files or URLs once, then query them instead of reading them again. ctx_search also covers earlier sandbox output in this project.
- ctx_resume: a short summary of this session, after the conversation was compacted or resumed.

For small output of known size, such as git status, ls or a short file, and for editing files, use your normal tools: they are faster there.

A large file's Read is denied. Use Read with offset/limit, or ctx_execute with file set.