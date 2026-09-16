use rasn_compiler::prelude::*;
fn main() {
    let schema = std::fs::read_to_string(std::env::args().nth(1).unwrap()).unwrap();
    let out = Compiler::<TypescriptBackend, _>::new_with_config(TsConfig::default())
        .add_asn_literal(&schema)
        .compile_to_string();
    match out {
        Ok(r) => println!("{}", r.generated),
        Err(e) => eprintln!("ERR {}", e),
    }
}
