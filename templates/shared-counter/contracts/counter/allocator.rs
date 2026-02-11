/// 256 KiB global allocator for dynamic storage
#[global_allocator]
static mut ALLOC: picoalloc::Mutex<picoalloc::Allocator<picoalloc::ArrayPointer<262144>>> = {
    static mut ARRAY: picoalloc::Array<262144> = picoalloc::Array([0u8; 262144]);

    picoalloc::Mutex::new(picoalloc::Allocator::new(unsafe {
        picoalloc::ArrayPointer::new(&raw mut ARRAY)
    }))
};
