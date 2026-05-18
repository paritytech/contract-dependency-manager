# CounterB

`CounterB` keeps its own local counter and demonstrates a CDM-powered cross-contract call to `CounterA`.

`incrementLocal()` updates only `CounterB`. `incrementA()`, `addToA(amount)`, and `readA()` use the generated Solidity import for `@example/counter-a`, so application code does not hardcode the `CounterA` address.
